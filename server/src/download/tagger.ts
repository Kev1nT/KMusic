import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { xmlEscape } from './naming.js'

const exec = promisify(execFile)

export interface ProbeResult {
  duration: number
  bitRate: number
  formatName: string
  codec: string
  sampleRate: number
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await exec(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { maxBuffer: 8 * 1024 * 1024 },
  )
  const data = JSON.parse(stdout)
  const audio = (data.streams || []).find((s: any) => s.codec_type === 'audio') || {}
  return {
    duration: Number(data.format?.duration || 0),
    bitRate: Number(data.format?.bit_rate || 0),
    formatName: String(data.format?.format_name || ''),
    codec: String(audio.codec_name || ''),
    sampleRate: Number(audio.sample_rate || 0),
  }
}

export interface TagInput {
  input: string
  output: string
  title: string
  artists: string[]
  album: string
  albumArtist?: string
  track?: number
  year?: string
  lyric?: string | null
  cover?: string | null
  ext: string
}

export async function tagAndFinalize(input: TagInput): Promise<void> {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input.input]
  const hasCover = Boolean(input.cover && fs.existsSync(input.cover))
  if (hasCover) args.push('-i', input.cover!)

  args.push('-map', '0:a')
  if (hasCover) args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic')
  args.push('-c:a', 'copy')

  const meta: Record<string, string> = {
    title: input.title,
    artist: input.artists.join(' / '),
    album: input.album,
    album_artist: input.albumArtist || input.artists[0] || '',
    track: input.track ? String(input.track) : '',
    date: input.year || '',
  }
  if (input.lyric) {
    meta.LYRICS = input.lyric
    meta.lyrics = input.lyric
  }
  for (const [k, v] of Object.entries(meta)) {
    if (v) args.push('-metadata', `${k}=${v}`)
  }
  if (input.ext === 'mp3') args.push('-id3v2_version', '3')
  args.push(input.output)

  await exec('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024 })
  if (!fs.existsSync(input.output) || fs.statSync(input.output).size === 0) {
    throw new Error('封装失败：输出文件为空')
  }
}

export async function writeLrc(fileBase: string, lyric: string) {
  fs.writeFileSync(`${fileBase}.lrc`, lyric, 'utf8')
}

export function writeAlbumNfo(
  dir: string,
  info: { album: string; artists: string[]; year?: string; trackNo?: number },
) {
  const nfo = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<album>
  <title>${xmlEscape(info.album)}</title>
  <artist>${xmlEscape(info.artists.join(' / '))}</artist>
  <albumartist>${xmlEscape(info.artists[0] || '')}</albumartist>
  ${info.year ? `<year>${xmlEscape(info.year)}</year>` : ''}
  ${info.trackNo ? `<track>${info.trackNo}</track>` : ''}
</album>
`
  fs.writeFileSync(path.join(dir, 'album.nfo'), nfo, 'utf8')
}
