import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { deleteRecord, getRecords, saveRecord, type RecordEntry } from './db'
import './App.css'

type CalendarMode = 'week' | 'month' | 'year'
type NativeTab = 'quick' | 'calendar' | 'records'

const paletteColors = [
  '#A96800', '#E0B458', '#805238',
  '#B96D4B', '#74844A', '#5F7898',
]
const removedDefaultPresetColor = '#C7822B'
const weekDays = ['一', '二', '三', '四', '五', '六', '日']
const iosBackupTimestampKey = 'shiji-ios-last-backup'
const webBackupTimestampKey = 'shiji-last-backup'
const backupDirectory = 'ShiJi/backups'
const dailyBackupInterval = 24 * 60 * 60 * 1000

async function shareFileFromApp(blob: Blob, fileName: string, title: string) {
  const path = `${Date.now()}-${fileName}`
  const isText = blob.type.startsWith('text/') || blob.type === 'application/json'
  let data: string
  if (isText) {
    data = await blob.text()
  } else {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('file read failed'))
      reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
      reader.readAsDataURL(blob)
    })
    data = dataUrl.slice(dataUrl.indexOf(',') + 1)
  }

  const { uri } = await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Cache,
    ...(isText ? { encoding: Encoding.UTF8 } : {}),
  })
  try {
    await Share.share({ files: [uri], title })
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined)
  }
}

function readStoredPresetColors() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('shiji-preset-colors') ?? 'null')
    if (Array.isArray(value)) {
      return [...new Set(value.filter((color): color is string => typeof color === 'string' && /^#[0-9A-F]{6}$/i.test(color)).map((color) => color.toUpperCase()))]
    }
  } catch {
    // Fall back to the built-in palette if the saved settings are invalid.
  }
  return paletteColors
}

function createBackupJson(records: RecordEntry[], presetColors: string[], backedUpAt: string) {
  const legacyCustomPresets = presetColors.filter((preset) => !paletteColors.includes(preset))
  return JSON.stringify({ formatVersion: 3, backedUpAt, records, presetColors, customPresetColors: legacyCustomPresets }, null, 2)
}

function readPresetColors() {
  try {
    const savedPresets: unknown = JSON.parse(localStorage.getItem('shiji-preset-colors') ?? 'null')
    const oldCustomPresets: unknown = JSON.parse(localStorage.getItem('shiji-custom-presets') ?? '[]')
    const source = Array.isArray(savedPresets)
      ? savedPresets
      : [...paletteColors, ...(Array.isArray(oldCustomPresets) ? oldCustomPresets : [])]
    const normalized = [...new Set(source.filter((color): color is string => typeof color === 'string' && /^#[0-9A-F]{6}$/i.test(color)).map((color) => color.toUpperCase()))]
    if (!localStorage.getItem('shiji-preset-defaults-v3')) {
      localStorage.setItem('shiji-preset-defaults-v3', '1')
      return normalized.filter((color) => color !== removedDefaultPresetColor)
    }
    return normalized
  } catch {
    return []
  }
}

function toLocalInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function createRecordId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function formatNativeRecordTimes(startValue: string, endValue: string) {
  const start = new Date(startValue)
  const end = new Date(endValue)
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' })
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

  if (start.getTime() === end.getTime()) return `${dateFormatter.format(start)} ${timeFormatter.format(start)}`
  if (start.toDateString() === end.toDateString()) {
    return `${dateFormatter.format(start)} ${timeFormatter.format(start)}–${timeFormatter.format(end)}`
  }
  return `${dateFormatter.format(start)} ${timeFormatter.format(start)}–${dateFormatter.format(end)} ${timeFormatter.format(end)}`
}

function formatBackupDate(value: string | null) {
  if (!value) return '尚未备份'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value))
}

function formatBackupDateTime(value: string | null) {
  if (!value) return '尚未备份'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))
}

function formatNativeBackupDateTime(value: string | null) {
  if (!value) return '尚未备份'
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7))
  return result
}

function periodBounds(mode: CalendarMode, date: Date) {
  const start = mode === 'week'
    ? startOfWeek(date)
    : mode === 'month'
      ? new Date(date.getFullYear(), date.getMonth(), 1)
      : new Date(date.getFullYear(), 0, 1)
  const end = mode === 'week'
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
    : mode === 'month'
      ? new Date(date.getFullYear(), date.getMonth() + 1, 1)
      : new Date(date.getFullYear() + 1, 0, 1)
  return { start, end }
}

function periodTitle(mode: CalendarMode, date: Date) {
  if (mode === 'year') return `${date.getFullYear()}年`
  if (mode === 'month') return `${date.getFullYear()}年 ${date.getMonth() + 1}月`
  const first = startOfWeek(date)
  const last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6)
  return `${first.getMonth() + 1}/${first.getDate()} – ${last.getMonth() + 1}/${last.getDate()}`
}

function shiftPeriod(date: Date, mode: CalendarMode, amount: number) {
  if (mode === 'year') return new Date(date.getFullYear() + amount, date.getMonth(), 1)
  if (mode === 'month') return new Date(date.getFullYear(), date.getMonth() + amount, 1)
  const next = new Date(date)
  next.setDate(next.getDate() + amount * 7)
  return next
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}

function averageHex(records: RecordEntry[]) {
  const colors = records.map((record) => record.color).filter((value) => /^#[0-9A-F]{6}$/i.test(value))
  if (!colors.length) return null
  return `#${[1, 3, 5].map((index) => Math.round(colors.reduce((sum, value) => sum + parseInt(value.slice(index, index + 2), 16), 0) / colors.length).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function buildShareSvg(mode: CalendarMode, date: Date, records: RecordEntry[], includeStats: boolean) {
  const { start, end } = periodBounds(mode, date)
  const entries = records.filter((record) => {
    const time = new Date(record.startAt).getTime()
    return time >= start.getTime() && time < end.getTime()
  })
  const width = 1200
  const margin = 56
  const cardX = margin
  const cardWidth = width - margin * 2
  const headerHeight = 190
  const statsHeight = includeStats ? 170 : 0
  let contentHeight = 0
  let contentBottom = 0
  let calendarContent = ''
  const text = (x: number, y: number, value: string, size: number, color = '#29251f', weight = 500, anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(value)}</text>`
  const iconFor = (record: RecordEntry, x: number, y: number, size: number) => {
    const color = /^#[0-9A-F]{6}$/i.test(record.color) ? record.color : 'transparent'
    const poop = 'M 89.3,104.9 C 78.3,101.8 71.0,94.0 72.8,83.0 C 74.3,69.8 84.7,63.2 99.1,57.8 C 106.8,54.3 108.8,38.1 117.6,38.5 C 132.4,39.1 140.5,53.2 142.2,67.0 C 156.3,67.7 168.8,78.5 169.9,90.8 C 170.2,95.1 168.2,98.7 165.1,101.8 C 180.2,104.5 189.6,114.9 189.0,127.3 C 188.1,144.7 172.6,154.1 144.7,154.6 C 130.9,155.2 109.7,155.1 96.5,154.6 C 64.5,153.7 47.4,145.6 47.3,125.4 C 47.2,111.2 56.6,96.9 73.9,91.8'
    const spicy = record.note.includes('#吃辣了')
      ? '<g transform="translate(15 -1) scale(.38)"><path d="M12.2 21c-4.1 0-7-2.7-7-6.6 0-3.1 2-5.5 4.2-7.8.2 2 1.2 3.1 2.3 3.4-.2-3.3 1.3-5.8 3.8-7.7-.1 3.2 1.4 4.7 2.5 6.8 1 1.8 1.5 3.3 1.5 5.2 0 3.9-3 6.7-7.3 6.7Z" fill="#D96F36" stroke="#211D19" stroke-width="2.8" stroke-linejoin="round"/><path d="M12.1 18.4c-1.5 0-2.6-1-2.6-2.5 0-1.3.9-2.4 2.1-3.5.2 1.1.7 1.6 1.5 1.9-.1-1.5.6-2.7 1.6-3.5.1 1.5 1.5 2.4 1.5 4.6 0 1.8-1.7 3-4.1 3Z" fill="#F5C56E"/></g>'
      : ''
    return `<g transform="translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})"><svg x="0" y="0" width="24" height="24" viewBox="35 26 168 140"><path d="${poop}" fill="${color}" stroke="#211D19" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round"/></svg>${spicy}</g>`
  }
  const orderedEntries = [...entries].sort((a, b) => a.startAt.localeCompare(b.startAt))
  const dayMap = new Map<string, RecordEntry[]>()
  for (const record of orderedEntries) {
    const key = dateKey(new Date(record.startAt))
    dayMap.set(key, [...(dayMap.get(key) ?? []), record])
  }

  if (mode === 'month') {
    const first = new Date(date.getFullYear(), date.getMonth(), 1)
    const gridStart = startOfWeek(first)
    const gridX = cardX + 30
    const gridY = headerHeight + 84
    const cellW = (cardWidth - 60) / 7
    const cellH = 86
    weekDays.forEach((day, index) => { calendarContent += text(gridX + cellW * (index + .5), gridY - 24, day, 19, '#918a80', 500) })
    for (let index = 0; index < 42; index += 1) {
      const current = new Date(gridStart)
      current.setDate(gridStart.getDate() + index)
      const col = index % 7
      const row = Math.floor(index / 7)
      const x = gridX + col * cellW
      const y = gridY + row * cellH
      const inMonth = current.getMonth() === date.getMonth()
      calendarContent += `<rect x="${x + 3}" y="${y + 3}" width="${cellW - 6}" height="${cellH - 6}" rx="14" fill="${inMonth ? '#ffffff' : '#faf9f7'}" stroke="#e9e5de"/>`
      calendarContent += text(x + cellW / 2, y + 29, `${current.getDate()}`, 19, inMonth ? '#29251f' : '#c4beb5', 500)
      const recordsOnDate = dayMap.get(dateKey(current)) ?? []
      const size = recordsOnDate.length > 1 ? 28 : 44
      const totalWidth = recordsOnDate.length * size * .7
      recordsOnDate.forEach((record, recordIndex) => {
        const iconX = x + cellW / 2 - totalWidth / 2 + size * .35 + recordIndex * size * .7
        calendarContent += iconFor(record, iconX, y + 61, size)
      })
    }
    contentBottom = gridY + 6 * cellH
  } else if (mode === 'week') {
    const gridX = cardX + 52
    const gridY = headerHeight + 74
    const gridW = cardWidth - 107
    const dayW = gridW / 7
    const hourH = 32
    const axisW = 55
    const dataX = gridX + axisW
    weekDays.forEach((day, index) => {
      const current = new Date(start)
      current.setDate(start.getDate() + index)
      calendarContent += text(dataX + dayW * (index + .5), gridY - 24, `${day} ${current.getMonth() + 1}/${current.getDate()}`, 16, '#746d63', 550)
    })
    for (let hour = 0; hour <= 24; hour += 1) {
      const y = gridY + hour * hourH
      if (hour < 24) calendarContent += text(gridX + axisW - 10, y + 5, `${String(hour).padStart(2, '0')}:00`, 12, '#a49c91', 400, 'end')
      calendarContent += `<line x1="${dataX}" y1="${y}" x2="${dataX + dayW * 7}" y2="${y}" stroke="#e9e5de" stroke-width="1"/>`
    }
    for (let day = 0; day < 7; day += 1) {
      const current = new Date(start)
      current.setDate(start.getDate() + day)
      const recordsOnDate = dayMap.get(dateKey(current)) ?? []
      calendarContent += `<line x1="${dataX + dayW * day}" y1="${gridY}" x2="${dataX + dayW * day}" y2="${gridY + hourH * 24}" stroke="#eeeae5"/>`
      recordsOnDate.forEach((record) => {
        const recordStart = new Date(record.startAt)
        const recordEnd = new Date(record.endAt)
        const startMinutes = recordStart.getHours() * 60 + recordStart.getMinutes()
        const endMinutes = recordEnd.getHours() * 60 + recordEnd.getMinutes()
        const midpoint = (startMinutes + endMinutes) / 2
        const y = gridY + midpoint / 60 * hourH
        const x = dataX + dayW * (day + .5)
        const color = /^#[0-9A-F]{6}$/i.test(record.color) ? record.color : '#c8c1b7'
        calendarContent += `<rect x="${dataX + dayW * day + 5}" y="${gridY + startMinutes / 60 * hourH}" width="${dayW - 10}" height="${Math.max(4, (endMinutes - startMinutes) / 60 * hourH)}" rx="8" fill="${color}" fill-opacity=".16"/>`
        calendarContent += iconFor(record, x, y, 33)
      })
    }
    contentBottom = gridY + hourH * 24
  } else {
    const dayCount = new Date(date.getFullYear(), 1, 29).getMonth() === 1 ? 366 : 365
    const cols = 25
    const gap = 7
    const cell = (cardWidth - 70 - (cols - 1) * gap) / cols
    const rows = Math.ceil((dayCount + 12) / cols)
    const gridX = cardX + 35
    const gridY = headerHeight + 45
    let slotIndex = 0
    for (let index = 0; index < dayCount; index += 1) {
      const current = new Date(date.getFullYear(), 0, index + 1)
      if (current.getDate() === 1) {
        const labelCol = slotIndex % cols
        const labelRow = Math.floor(slotIndex / cols)
        const labelX = gridX + labelCol * (cell + gap)
        const labelY = gridY + labelRow * (cell + gap)
        calendarContent += text(labelX + cell / 2, labelY + cell * .68, `${current.getMonth() + 1}`, Math.max(12, cell * .46), '#a96800', 700)
        slotIndex += 1
      }
      const col = slotIndex % cols
      const row = Math.floor(slotIndex / cols)
      const x = gridX + col * (cell + gap)
      const y = gridY + row * (cell + gap)
      slotIndex += 1
      const recordsOnDate = dayMap.get(dateKey(current)) ?? []
      calendarContent += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="5" fill="${recordsOnDate.length ? '#ffffff' : '#f0ede8'}" stroke="#ddd7ce"/>`
      if (recordsOnDate.length) {
        const count = recordsOnDate.length
        const iconSize = Math.min(cell * .82, count > 1 ? cell * .43 : cell * .82)
        recordsOnDate.slice(0, 4).forEach((record, recordIndex) => {
          const xOffset = count > 1 ? (recordIndex % 2 ? 1 : -1) * cell * .2 : 0
          const yOffset = count > 1 ? (recordIndex > 1 ? 1 : -1) * cell * .2 : 0
          calendarContent += iconFor(record, x + cell / 2 + xOffset, y + cell / 2 + yOffset, iconSize)
        })
        if (count > 4) calendarContent += text(x + cell - 1, y + 11, `+${count - 4}`, 8, '#6e5b42', 700, 'end')
      }
    }
    contentBottom = gridY + rows * (cell + gap) - gap
  }

  contentHeight = includeStats
    ? contentBottom - margin - headerHeight - 4
    : contentBottom - headerHeight
  const totalHeight = margin + headerHeight + contentHeight + statsHeight + margin
  let statsMarkup = ''
  const statsColor = averageHex(entries) ?? '#A96800'
  if (includeStats) {
    const colors = entries.filter((record) => /^#[0-9A-F]{6}$/i.test(record.color))
    const statuses = entries.map((record) => record.status).filter((value): value is number => value !== null)
    const ratings = entries.map((record) => record.rating).filter((value): value is number => value !== null)
    const color = averageHex(entries)
    const averageStatus = statuses.length ? statuses.reduce((sum, value) => sum + value, 0) / statuses.length : null
    const averageRating = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null
    const y = margin + headerHeight + contentHeight + 22
    const gap = 16
    const statW = (cardWidth - gap * 2) / 3
    const cardXFor = (index: number) => cardX + index * (statW + gap)
    const card = (index: number, count: string, content: string) => `<rect x="${cardXFor(index)}" y="${y}" width="${statW}" height="142" rx="22" fill="#faf8f4"/>${text(cardXFor(index) + 24, y + 32, count, 21, '#8e8997', 400, 'start')}${content}`
    const averageColorContent = color
      ? `<rect x="${cardXFor(0) + 24}" y="${y + 58}" width="66" height="66" rx="17" fill="${color}" stroke="#cfc8bd"/>${text(cardXFor(0) + 104, y + 99, color, 24, '#24212b', 600, 'start')}`
      : text(cardXFor(0) + 24, y + 101, '暂无颜色数据', 21, '#8e8997', 400, 'start')
    const averageStatusContent = averageStatus === null
      ? text(cardXFor(1) + 24, y + 101, '暂无状态数据', 21, '#8e8997', 400, 'start')
      : `<rect x="${cardXFor(1) + 32}" y="${y + 83}" width="${statW - 64}" height="6" rx="3" fill="#d8d2c8"/><svg x="${cardXFor(1) + 32 + (statW - 64) * averageStatus - 27}" y="${y + 56}" width="54" height="54" viewBox="35 26 168 140"><path d="M 89.3,104.9 C 78.3,101.8 71.0,94.0 72.8,83.0 C 74.3,69.8 84.7,63.2 99.1,57.8 C 106.8,54.3 108.8,38.1 117.6,38.5 C 132.4,39.1 140.5,53.2 142.2,67.0 C 156.3,67.7 168.8,78.5 169.9,90.8 C 170.2,95.1 168.2,98.7 165.1,101.8 C 180.2,104.5 189.6,114.9 189.0,127.3 C 188.1,144.7 172.6,154.1 144.7,154.6 C 130.9,155.2 109.7,155.1 96.5,154.6 C 64.5,153.7 47.4,145.6 47.3,125.4 C 47.2,111.2 56.6,96.9 73.9,91.8" fill="${color ?? 'transparent'}" stroke="#211D19" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round"/></svg>${text(cardXFor(1) + 24, y + 128, '上善若水', 18, '#8e8997', 400, 'start')}${text(cardXFor(1) + statW - 24, y + 128, '坚如磐石', 18, '#8e8997', 400, 'end')}`
    const averageRatingContent = averageRating === null
      ? text(cardXFor(2) + 24, y + 101, '暂无评价数据', 21, '#8e8997', 400, 'start')
      : `${text(cardXFor(2) + 24, y + 93, '艰难', 18, '#8e8997', 400, 'start')}<text x="${cardXFor(2) + statW / 2}" y="${y + 101}" text-anchor="middle" font-family="Arial,sans-serif" font-size="39" letter-spacing="-3" fill="url(#average-stars)">★★★★★</text>${text(cardXFor(2) + statW - 24, y + 93, '顺畅', 18, '#8e8997', 400, 'end')}`
    statsMarkup = card(0, `${colors.length} 条有颜色`, averageColorContent)
      + card(1, `${statuses.length} 条有状态`, averageStatusContent)
      + card(2, `${ratings.length} 条有评价`, averageRatingContent)
  }

  const averageRatingValue = entries.map((record) => record.rating).filter((value): value is number => value !== null)
  const ratingFill = `${(averageRatingValue.length ? averageRatingValue.reduce((sum, value) => sum + value, 0) / averageRatingValue.length / 5 : 0) * 100}%`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}"><defs><linearGradient id="average-stars"><stop offset="${ratingFill}" stop-color="${statsColor}"/><stop offset="${ratingFill}" stop-color="#d8d2c8"/></linearGradient></defs><rect width="100%" height="100%" fill="#f8f6f2"/><rect x="${cardX}" y="${margin}" width="${cardWidth}" height="${headerHeight + contentHeight + statsHeight}" rx="34" fill="#fff" stroke="#e9e5de" stroke-width="2"/>${text(width / 2, margin + 65, 'ShiJi', 34, '#29251f', 700)}${text(width / 2, margin + 119, periodTitle(mode, date), 27, '#746d63', 500)}${text(width / 2, margin + 160, `${entries.length} 条记录`, 16, '#a49c91', 400)}${calendarContent}${statsMarkup}</svg>`
}

function monthGrid(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const firstDay = startOfWeek(first)
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(firstDay)
    day.setDate(firstDay.getDate() + index)
    return day
  })
}

function makeSampleRecords(anchor: Date): RecordEntry[] {
  const at = (daysAgo: number, hour: number, minute: number, duration: number) => {
    const value = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - daysAgo, hour, minute)
    value.setMinutes(value.getMinutes() + duration)
    return value.toISOString()
  }
  const samples: Array<{ daysAgo: number; time: [number, number]; duration: number; color: string; status: number | null; rating: number | null; note: string }> = [
    { daysAgo: 0, time: [19, 5], duration: 0, color: '#A96800', status: 0.52, rating: 3, note: '样例：短暂记录 #吃辣了' },
    { daysAgo: 1, time: [8, 10], duration: 7, color: '#E0B458', status: 0.42, rating: 4, note: '样例：早餐后' },
    { daysAgo: 2, time: [21, 35], duration: 11, color: '#805238', status: 0.78, rating: 2, note: '样例：稍费力' },
    { daysAgo: 4, time: [7, 50], duration: 6, color: '#B96D4B', status: 0.31, rating: 5, note: '样例：很顺畅 #吃辣了' },
    { daysAgo: 5, time: [18, 25], duration: 9, color: '#5F7898', status: 0.61, rating: 4, note: '样例：吃了火龙果' },
    { daysAgo: 7, time: [12, 15], duration: 4, color: '', status: null, rating: null, note: '' },
    { daysAgo: 9, time: [9, 5], duration: 8, color: '#74844A', status: 0.83, rating: 2, note: '样例：偏硬' },
    { daysAgo: 10, time: [22, 40], duration: 0, color: '#A96800', status: null, rating: 3, note: '样例：结束时间相同' },
    { daysAgo: 12, time: [8, 0], duration: 5, color: '#E0B458', status: 0.48, rating: 4, note: '样例：早晨' },
    { daysAgo: 12, time: [20, 20], duration: 12, color: '#B96D4B', status: 0.66, rating: 3, note: '样例：同日第二次 #吃辣了' },
    { daysAgo: 14, time: [15, 10], duration: 8, color: '#805238', status: 0.73, rating: 2, note: '样例：稍干' },
    { daysAgo: 16, time: [6, 55], duration: 6, color: '#A96800', status: 0.37, rating: 5, note: '样例：起床后' },
    { daysAgo: 18, time: [13, 30], duration: 10, color: '#9B6FC0', status: 0.55, rating: 3, note: '样例：吃了甜菜根' },
    { daysAgo: 20, time: [8, 35], duration: 7, color: '#E0B458', status: 0.44, rating: 4, note: '样例：早餐后' },
    { daysAgo: 20, time: [19, 10], duration: 5, color: '', status: 0.59, rating: null, note: '样例：无颜色' },
    { daysAgo: 22, time: [16, 0], duration: 13, color: '#74844A', status: 0.91, rating: 1, note: '样例：比较费力' },
    { daysAgo: 24, time: [10, 20], duration: 6, color: '#A96800', status: null, rating: 4, note: '样例：未填状态' },
    { daysAgo: 26, time: [23, 15], duration: 0, color: '#805238', status: 0.64, rating: 3, note: '样例：夜间' },
    { daysAgo: 28, time: [7, 25], duration: 8, color: '#B96D4B', status: 0.29, rating: 5, note: '样例：顺畅' },
    { daysAgo: 29, time: [18, 45], duration: 9, color: '#5F7898', status: 0.57, rating: 3, note: '样例：颜色偏蓝' },
    { daysAgo: 32, time: [8, 15], duration: 6, color: '#A96800', status: 0.46, rating: 4, note: '样例：月初' },
    { daysAgo: 34, time: [20, 5], duration: 11, color: '#805238', status: 0.82, rating: 2, note: '样例：偏硬 #吃辣了' },
    { daysAgo: 36, time: [12, 40], duration: 7, color: '#E0B458', status: 0.51, rating: 3, note: '样例：午餐后' },
    { daysAgo: 39, time: [7, 35], duration: 5, color: '#B96D4B', status: 0.33, rating: 5, note: '样例：早晨' },
    { daysAgo: 39, time: [18, 55], duration: 8, color: '#74844A', status: 0.68, rating: 3, note: '样例：同日第二次' },
    { daysAgo: 42, time: [14, 10], duration: 10, color: '', status: null, rating: 2, note: '样例：无颜色记录' },
    { daysAgo: 46, time: [9, 20], duration: 6, color: '#A96800', status: 0.41, rating: 4, note: '' },
    { daysAgo: 48, time: [22, 5], duration: 0, color: '#9B6FC0', status: 0.62, rating: 3, note: '样例：甜菜根后' },
    { daysAgo: 51, time: [11, 45], duration: 8, color: '#E0B458', status: null, rating: null, note: '样例：只记录颜色' },
    { daysAgo: 54, time: [7, 10], duration: 5, color: '#B96D4B', status: 0.28, rating: 5, note: '样例：很顺畅' },
    { daysAgo: 57, time: [17, 30], duration: 12, color: '#805238', status: 0.88, rating: 1, note: '样例：明显费力' },
    { daysAgo: 60, time: [8, 50], duration: 7, color: '#74844A', status: 0.71, rating: 2, note: '样例：稍干' },
    { daysAgo: 63, time: [19, 25], duration: 8, color: '#A96800', status: 0.53, rating: 3, note: '样例：晚间' },
    { daysAgo: 66, time: [6, 45], duration: 6, color: '#E0B458', status: 0.39, rating: 4, note: '样例：起床后' },
    { daysAgo: 70, time: [13, 5], duration: 9, color: '#5F7898', status: 0.58, rating: 3, note: '样例：吃了火龙果' },
    { daysAgo: 74, time: [20, 30], duration: 0, color: '', status: 0.5, rating: null, note: '样例：未填颜色和评价' },
    { daysAgo: 77, time: [8, 25], duration: 7, color: '#B96D4B', status: 0.35, rating: 5, note: '样例：顺畅 #吃辣了' },
    { daysAgo: 80, time: [15, 50], duration: 10, color: '#805238', status: 0.76, rating: 2, note: '样例：偏硬' },
    { daysAgo: 84, time: [7, 55], duration: 6, color: '#E0B458', status: null, rating: 4, note: '样例：未填状态' },
    { daysAgo: 89, time: [18, 0], duration: 9, color: '#A96800', status: 0.49, rating: 3, note: '样例：三个月前' },
  ]
  return samples.map((sample, index) => ({
    id: `sample-${index}`,
    startAt: at(sample.daysAgo, sample.time[0], sample.time[1], 0),
    endAt: at(sample.daysAgo, sample.time[0], sample.time[1], sample.duration),
    color: sample.color,
    status: sample.status,
    rating: sample.rating,
    note: sample.note,
  }))
}

function hexToHue(hex: string) {
  if (!/^#[0-9A-F]{6}$/i.test(hex)) return 38
  const red = parseInt(hex.slice(1, 3), 16) / 255
  const green = parseInt(hex.slice(3, 5), 16) / 255
  const blue = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  if (delta === 0) return 0
  let hue = 0
  if (max === red) hue = ((green - blue) / delta) % 6
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  return Math.round((hue * 60 + 360) % 360)
}

const hueStops = [
  { position: 0, hue: 0 },
  { position: 20, hue: 20 },
  { position: 65, hue: 70 },
  { position: 78, hue: 150 },
  { position: 86, hue: 200 },
  { position: 94, hue: 260 },
  { position: 100, hue: 360 },
]

function positionToHue(position: number) {
  const stop = hueStops.findIndex((point) => point.position >= position)
  const right = hueStops[Math.max(1, stop)]
  const left = hueStops[Math.max(0, stop - 1)]
  const ratio = (position - left.position) / (right.position - left.position)
  return Math.round(left.hue + (right.hue - left.hue) * ratio) % 360
}

function hueToPosition(hue: number) {
  const degrees = hue === 0 ? 360 : hue
  const stop = hueStops.findIndex((point) => point.hue >= degrees)
  const right = hueStops[Math.max(1, stop)]
  const left = hueStops[Math.max(0, stop - 1)]
  const ratio = (degrees - left.hue) / (right.hue - left.hue)
  return Math.round(left.position + (right.position - left.position) * ratio)
}

function hslToHex(hue: number, lightness: number) {
  const saturation = 0.72
  const lightnessRatio = lightness / 100
  const chroma = (1 - Math.abs(2 * lightnessRatio - 1)) * saturation
  const section = hue / 60
  const secondary = chroma * (1 - Math.abs((section % 2) - 1))
  const [red, green, blue] = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary]
  const offset = lightnessRatio - chroma / 2
  return `#${[red, green, blue].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function hexToLightness(hex: string) {
  if (!/^#[0-9A-F]{6}$/i.test(hex)) return 46
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  return Math.round((Math.max(...channels) + Math.min(...channels)) * 50)
}

function withAlpha(hex: string, alpha: number) {
  if (!/^#[0-9A-F]{6}$/i.test(hex)) return 'transparent'
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
}

function PoopIcon({ color, size = 20, className = '', style, spicy = false }: { color: string; size?: number; className?: string; style?: React.CSSProperties; spicy?: boolean }) {
  return (
    <svg className={`poop-icon ${className}`} width={size} height={size} viewBox="35 26 168 140" style={style} aria-hidden="true">
      <path
        d="M 89.3,104.9 C 78.3,101.8 71.0,94.0 72.8,83.0 C 74.3,69.8 84.7,63.2 99.1,57.8 C 106.8,54.3 108.8,38.1 117.6,38.5 C 132.4,39.1 140.5,53.2 142.2,67.0 C 156.3,67.7 168.8,78.5 169.9,90.8 C 170.2,95.1 168.2,98.7 165.1,101.8 C 180.2,104.5 189.6,114.9 189.0,127.3 C 188.1,144.7 172.6,154.1 144.7,154.6 C 130.9,155.2 109.7,155.1 96.5,154.6 C 64.5,153.7 47.4,145.6 47.3,125.4 C 47.2,111.2 56.6,96.9 73.9,91.8"
        fill={color || 'transparent'}
        stroke="#211D19"
        strokeWidth="9.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {spicy && <g transform="translate(140 20.2) scale(2.66 2.22)"><path d="M12.2 21c-4.1 0-7-2.7-7-6.6 0-3.1 2-5.5 4.2-7.8.2 2 1.2 3.1 2.3 3.4-.2-3.3 1.3-5.8 3.8-7.7-.1 3.2 1.4 4.7 2.5 6.8 1 1.8 1.5 3.3 1.5 5.2 0 3.9-3 6.7-7.3 6.7Z" fill="#D96F36" stroke="#211D19" strokeWidth="2.8" strokeLinejoin="round"/><path d="M12.1 18.4c-1.5 0-2.6-1-2.6-2.5 0-1.3.9-2.4 2.1-3.5.2 1.1.7 1.6 1.5 1.9-.1-1.5.6-2.7 1.6-3.5.1 1.5 1.5 2.4 1.5 4.6 0 1.8-1.7 3-4.1 3Z" fill="#F5C56E" stroke="none"/></g>}
    </svg>
  )
}

function PepperIcon() {
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.2 21c-4.1 0-7-2.7-7-6.6 0-3.1 2-5.5 4.2-7.8.2 2 1.2 3.1 2.3 3.4-.2-3.3 1.3-5.8 3.8-7.7-.1 3.2 1.4 4.7 2.5 6.8 1 1.8 1.5 3.3 1.5 5.2 0 3.9-3 6.7-7.3 6.7Z" fill="#D96F36" stroke="#211D19" strokeWidth="1.7" strokeLinejoin="round"/><path d="M12.1 18.4c-1.5 0-2.6-1-2.6-2.5 0-1.3.9-2.4 2.1-3.5.2 1.1.7 1.6 1.5 1.9-.1-1.5.6-2.7 1.6-3.5.1 1.5 1.5 2.4 1.5 4.6 0 1.8-1.7 3-4.1 3Z" fill="#F5C56E" stroke="#211D19" strokeWidth="1.3" strokeLinejoin="round"/></svg>
}

function NoteIcon() {
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 3.5h9l4.5 4.7v12H4.5z" fill="#FFF8ED" stroke="#211D19" strokeWidth="1.7" strokeLinejoin="round"/><path d="M13.5 3.8v4.8h4.2M7.5 12h6" fill="none" stroke="#211D19" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="m12.4 17.8 5.3-6.2 2.1 1.8-5.3 6.2-2.7.7.6-2.5Z" fill="#E0B458" stroke="#211D19" strokeWidth="1.4" strokeLinejoin="round"/></svg>
}

function ResetIcon() {
  return <svg className="action-icon reset-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 10A8 8 0 1 1 4 14"/><path d="M4.2 4.8V10h5.2"/></svg>
}

function NativeTabIcon({ tab }: { tab: NativeTab }) {
  if (tab === 'quick') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.8h14a1.8 1.8 0 0 1 1.8 1.8v13.1a1.5 1.5 0 0 1-1.5 1.5H4.7a1.5 1.5 0 0 1-1.5-1.5V5.6A1.8 1.8 0 0 1 5 3.8Z"/><path d="M12 8v8M8 12h8"/></svg>
  if (tab === 'calendar') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9h17M8 12.5h.01M12 12.5h.01M16 12.5h.01M8 16h.01M12 16h.01M16 16h.01"/></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5h12M8.5 12h12M8.5 19h12"/><circle cx="4" cy="5" r=".8"/><circle cx="4" cy="12" r=".8"/><circle cx="4" cy="19" r=".8"/></svg>
}

function App() {
  const openedAt = useMemo(() => new Date(), [])
  const initialTime = toLocalInputValue(openedAt)
  const [activeStart, setActiveStart] = useState<string | null>(() => localStorage.getItem('shiji-active-start'))
  const [selectedDate, setSelectedDate] = useState(() => activeStart ? toLocalInputValue(new Date(activeStart)).slice(0, 10) : initialTime.slice(0, 10))
  const [startAt, setStartAt] = useState(() => activeStart ? toLocalInputValue(new Date(activeStart)) : initialTime)
  const [endAt, setEndAt] = useState(() => activeStart ? toLocalInputValue(new Date(activeStart)) : initialTime)
  const [color, setColor] = useState('')
  const [presetColors, setPresetColors] = useState<string[]>(readPresetColors)
  const [presetEditorOpen, setPresetEditorOpen] = useState(false)
  const [hue, setHue] = useState(38)
  const [lightness, setLightness] = useState(46)
  const [editingHex, setEditingHex] = useState(false)
  const [hexDraft, setHexDraft] = useState('')
  const [status, setStatus] = useState<number | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [noteEditorOpen, setNoteEditorOpen] = useState(false)
  const [records, setRecords] = useState<RecordEntry[]>([])
  const [showAllRecords, setShowAllRecords] = useState(false)
  const [recordEditMode, setRecordEditMode] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<RecordEntry | null>(null)
  const [recordListMessage, setRecordListMessage] = useState('')
  const [recordsLoaded, setRecordsLoaded] = useState(false)
  const [lastBackup, setLastBackup] = useState<string | null>(() => localStorage.getItem(Capacitor.isNativePlatform() ? iosBackupTimestampKey : webBackupTimestampKey))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuPopoverRef = useRef<HTMLDivElement>(null)
  const importFileRef = useRef<HTMLInputElement>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<{ records: RecordEntry[]; presetColors: string[] | null } | null>(null)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [importing, setImporting] = useState(false)
  const [shareMode, setShareMode] = useState<CalendarMode>('month')
  const [shareDate, setShareDate] = useState(() => new Date())
  const [shareIncludeStats, setShareIncludeStats] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [message, setMessage] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(() => activeStart ? Math.floor((Date.now() - new Date(activeStart).getTime()) / 1000) : 0)
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month')
  const [calendarDate, setCalendarDate] = useState(() => new Date())
  const [nativeTab, setNativeTab] = useState<NativeTab>('quick')
  const [nativeDemoMode, setNativeDemoMode] = useState(false)
  const [showSamples] = useState(import.meta.env.DEV)
  const backupInProgress = useRef(false)
  const allPresetColors = presetColors

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!menuButtonRef.current?.contains(target) && !menuPopoverRef.current?.contains(target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [menuOpen])

  useEffect(() => {
    getRecords()
      .then((loadedRecords) => {
        setRecords(loadedRecords)
        const previousColor = [...loadedRecords].sort((a, b) => b.startAt.localeCompare(a.startAt)).find((record) => /^#[0-9A-F]{6}$/i.test(record.color))?.color
        if (previousColor) {
          setHue(hexToHue(previousColor))
          setLightness(hexToLightness(previousColor))
        }
      })
      .catch(() => setMessage('暂时无法读取本机记录，请重新打开应用。'))
      .finally(() => setRecordsLoaded(true))
  }, [])

  useEffect(() => {
    if (!activeStart) {
      setElapsedSeconds(0)
      return
    }
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(activeStart).getTime()) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [activeStart])

  useEffect(() => {
    localStorage.setItem('shiji-preset-colors', JSON.stringify(presetColors))
  }, [presetColors])

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !recordsLoaded) return
    let active = true
    let checking = false

    const checkAndCreateDailyBackup = async () => {
      if (!active || checking || backupInProgress.current || document.visibilityState !== 'visible') return
      checking = true
      backupInProgress.current = true
      try {
        const previousBackup = localStorage.getItem(iosBackupTimestampKey)
        const previousTime = previousBackup ? Date.parse(previousBackup) : Number.NaN
        const elapsed = Date.now() - previousTime
        if (Number.isFinite(previousTime) && elapsed >= 0 && elapsed < dailyBackupInterval) return

        const backedUpAt = new Date().toISOString()
        const fileName = `ShiJi-auto-backup-${dateKey(new Date(backedUpAt))}.json`
        const json = createBackupJson(await getRecords(), readStoredPresetColors(), backedUpAt)
        await Filesystem.writeFile({
          path: `${backupDirectory}/${fileName}`,
          data: json,
          directory: Directory.Library,
          encoding: Encoding.UTF8,
          recursive: true,
        })
        localStorage.setItem(iosBackupTimestampKey, backedUpAt)
        if (active) setLastBackup(backedUpAt)
      } catch {
        if (active) setMessage('自动备份未完成，可点右上角“备份”重试。')
      } finally {
        checking = false
        backupInProgress.current = false
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkAndCreateDailyBackup()
    }
    void checkAndCreateDailyBackup()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [recordsLoaded])

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => b.startAt.localeCompare(a.startAt)),
    [records],
  )
  const sampleRecords = useMemo(() => makeSampleRecords(new Date()), [])
  const visibleRecords = useMemo(
    () => Capacitor.isNativePlatform()
      ? nativeDemoMode ? sampleRecords : records
      : showSamples ? [...records, ...sampleRecords] : records,
    [nativeDemoMode, records, sampleRecords, showSamples],
  )
  const sharePreviewSvg = useMemo(
    () => shareOpen ? buildShareSvg(shareMode, shareDate, visibleRecords, shareIncludeStats) : '',
    [visibleRecords, shareDate, shareIncludeStats, shareMode, shareOpen],
  )
  const recordsByDate = useMemo(() => {
    const grouped = new Map<string, RecordEntry[]>()
    for (const record of visibleRecords) {
      const key = dateKey(new Date(record.startAt))
      grouped.set(key, [...(grouped.get(key) ?? []), record])
    }
    for (const entries of grouped.values()) {
      entries.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id))
    }
    return grouped
  }, [visibleRecords])
  const weekDates = useMemo(() => {
    const first = startOfWeek(calendarDate)
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(first)
      date.setDate(first.getDate() + index)
      return date
    })
  }, [calendarDate])

  const calendarTitle = calendarMode === 'year'
    ? `${calendarDate.getFullYear()}年`
    : calendarMode === 'month'
      ? `${calendarDate.getFullYear()}年 ${calendarDate.getMonth() + 1}月`
      : `${weekDates[0].getMonth() + 1}月${weekDates[0].getDate()}日 – ${weekDates[6].getMonth() + 1}月${weekDates[6].getDate()}日`
  const isCurrentWeek = dateKey(startOfWeek(calendarDate)) === dateKey(startOfWeek(new Date()))
  const isCurrentMonth = calendarDate.getFullYear() === new Date().getFullYear() && calendarDate.getMonth() === new Date().getMonth()
  const isCurrentYear = calendarDate.getFullYear() === new Date().getFullYear()
  const statistics = useMemo(() => {
    const from = calendarMode === 'week'
      ? startOfWeek(calendarDate)
      : calendarMode === 'month'
        ? new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1)
        : new Date(calendarDate.getFullYear(), 0, 1)
    const until = calendarMode === 'week'
      ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7)
      : calendarMode === 'month'
        ? new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1)
        : new Date(calendarDate.getFullYear() + 1, 0, 1)
    const periodRecords = visibleRecords.filter((record) => {
      const time = new Date(record.startAt).getTime()
      return time >= from.getTime() && time < until.getTime()
    })
    const colors = periodRecords.map((record) => record.color).filter((value) => /^#[0-9A-F]{6}$/i.test(value))
    const averageColor = colors.length
      ? `#${[1, 3, 5].map((index) => Math.round(colors.reduce((sum, value) => sum + parseInt(value.slice(index, index + 2), 16), 0) / colors.length).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
      : null
    const statuses = periodRecords.map((record) => record.status).filter((value): value is number => value !== null)
    const ratings = periodRecords.map((record) => record.rating).filter((value): value is number => value !== null)
    return {
      count: periodRecords.length,
      averageColor,
      colorCount: colors.length,
      averageStatus: statuses.length ? statuses.reduce((sum, value) => sum + value, 0) / statuses.length : null,
      statusCount: statuses.length,
      averageRating: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null,
      ratingCount: ratings.length,
    }
  }, [calendarDate, calendarMode, visibleRecords])

  function moveCalendar(direction: number) {
    setCalendarDate((current) => {
      if (calendarMode === 'year') return new Date(current.getFullYear() + direction, current.getMonth(), 1)
      if (calendarMode === 'month') return new Date(current.getFullYear(), current.getMonth() + direction, 1)
      const next = new Date(current)
      next.setDate(next.getDate() + direction * 7)
      return next
    })
  }

  function chooseColor(nextColor: string) {
    setColor(nextColor)
    if (nextColor) {
      setHue(hexToHue(nextColor))
      setLightness(hexToLightness(nextColor))
    }
  }

  function addCurrentColorToPresets() {
    const nextColor = (color || hslToHex(hue, lightness)).toUpperCase()
    if (allPresetColors.includes(nextColor)) {
      setMessage('这个颜色已经在预设中了。')
      return
    }
    setPresetColors((current) => [...current, nextColor])
    chooseColor(nextColor)
    setPresetEditorOpen(false)
    setMessage('已添加自定义预设颜色。')
  }

  function removePresetColor(colorToRemove: string) {
    setPresetColors((current) => current.filter((preset) => preset !== colorToRemove))
  }

  function setHueColor(nextHue: number) {
    setHue(nextHue)
    setColor(hslToHex(nextHue, lightness))
  }

  function setColorLightness(nextLightness: number) {
    setLightness(nextLightness)
    setColor(hslToHex(hue, nextLightness))
  }

  function commitHex() {
    setEditingHex(false)
    const normalized = hexDraft.trim().toUpperCase()
    if (normalized === '') {
      chooseColor('')
      return
    }
    if (/^#[0-9A-F]{6}$/.test(normalized)) chooseColor(normalized)
    else setHexDraft(color)
  }

  async function copyCurrentHex() {
    const value = color || hslToHex(hue, lightness)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const input = document.createElement('textarea')
        input.value = value
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.appendChild(input)
        input.select()
        const copied = document.execCommand('copy')
        input.remove()
        if (!copied) throw new Error('Clipboard unavailable')
      }
      setMessage(`已复制 ${value}`)
    } catch {
      setMessage('复制失败，请检查剪贴板权限。')
    }
  }

  async function downloadBackup() {
    if (!recordsLoaded) {
      setMessage('记录仍在读取，请稍后再备份。')
      return
    }
    const backedUpAt = new Date().toISOString()
    const json = createBackupJson(records, presetColors, backedUpAt)
    const blob = new Blob([json], { type: 'application/json' })
    if (Capacitor.isNativePlatform() && backupInProgress.current) {
      setMessage('备份正在进行，请稍候。')
      return
    }
    try {
      if (Capacitor.isNativePlatform()) {
        backupInProgress.current = true
        const fileName = `ShiJi-backup-${dateKey(new Date(backedUpAt))}.json`
        await Filesystem.writeFile({
          path: `${backupDirectory}/${fileName}`,
          data: createBackupJson(await getRecords(), readStoredPresetColors(), backedUpAt),
          directory: Directory.Library,
          encoding: Encoding.UTF8,
          recursive: true,
        })
        localStorage.setItem(iosBackupTimestampKey, backedUpAt)
        setLastBackup(backedUpAt)
        setMessage('已备份到 ShiJi App 内。需要迁移或卸载前，请从菜单导出 JSON。')
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `ShiJi-backup-${dateKey(new Date(backedUpAt))}.json`
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setMessage('备份文件已生成')
        localStorage.setItem(webBackupTimestampKey, backedUpAt)
        setLastBackup(backedUpAt)
      }
    } catch {
      setMessage('备份导出失败，请稍后重试。')
    } finally {
      backupInProgress.current = false
    }
  }

  async function exportData() {
    setMenuOpen(false)
    if (!Capacitor.isNativePlatform()) {
      void downloadBackup()
      return
    }
    if (!recordsLoaded) {
      setMessage('记录仍在读取，请稍后再导出。')
      return
    }
    const backedUpAt = new Date().toISOString()
    const fileName = `ShiJi-backup-${dateKey(new Date(backedUpAt))}.json`
    try {
      const blob = new Blob([createBackupJson(await getRecords(), readStoredPresetColors(), backedUpAt)], { type: 'application/json' })
      await shareFileFromApp(blob, fileName, 'ShiJi 数据导出')
      setMessage('请在分享面板中选择“存储到文件”，可保存到本机或 iCloud Drive。')
    } catch {
      setMessage('JSON 导出失败，请稍后重试。')
    }
  }

  function chooseImportFile() {
    setMenuOpen(false)
    importFileRef.current?.click()
  }

  function openSharePanel() {
    setShareMode(calendarMode)
    setShareDate(new Date(calendarDate))
    setShareOpen(true)
    setMenuOpen(false)
  }

  async function generateShareImage() {
    setSharing(true)
    try {
      const svg = buildShareSvg(shareMode, shareDate, visibleRecords, shareIncludeStats)
      const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl = URL.createObjectURL(svgBlob)
      const image = new Image()
      image.src = svgUrl
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('image render failed'))
      })
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas unavailable')
      context.drawImage(image, 0, 0)
      URL.revokeObjectURL(svgUrl)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('png conversion failed')), 'image/png'))
      const file = new File([blob], `ShiJi-${shareMode}-${dateKey(shareDate)}.png`, { type: 'image/png' })
      if (Capacitor.isNativePlatform()) {
        await shareFileFromApp(blob, file.name, `ShiJi ${periodTitle(shareMode, shareDate)}`)
      } else if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `ShiJi ${periodTitle(shareMode, shareDate)}` })
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = file.name
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setMessage('日历图片已生成并下载')
      }
      setShareOpen(false)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setMessage('生成分享图片失败，请稍后重试。')
    } finally {
      setSharing(false)
    }
  }

  async function importData(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object' || !('records' in parsed) || !Array.isArray(parsed.records)) {
        throw new Error('invalid backup')
      }
      const imported = parsed.records as unknown[]
      let importedPresetColors: string[] | null = null
      if ('presetColors' in parsed || 'customPresetColors' in parsed) {
        const value = 'presetColors' in parsed ? parsed.presetColors : [...paletteColors, ...(Array.isArray(parsed.customPresetColors) ? parsed.customPresetColors : [])]
        if (!Array.isArray(value) || !value.every((preset): preset is string => typeof preset === 'string' && /^#[0-9A-F]{6}$/i.test(preset))) {
          throw new Error('invalid preset colors')
        }
        importedPresetColors = [...new Set(value.map((preset) => preset.toUpperCase()))]
        if (!('formatVersion' in parsed) || typeof parsed.formatVersion !== 'number' || parsed.formatVersion < 3) {
          importedPresetColors = importedPresetColors.filter((preset) => preset !== removedDefaultPresetColor)
        }
      }
      const isRecord = (value: unknown): value is RecordEntry => {
        if (!value || typeof value !== 'object') return false
        const item = value as Partial<RecordEntry>
        return typeof item.id === 'string' && item.id.length > 0
          && typeof item.startAt === 'string' && Number.isFinite(Date.parse(item.startAt))
          && typeof item.endAt === 'string' && Number.isFinite(Date.parse(item.endAt))
          && typeof item.color === 'string'
          && (item.status === null || (typeof item.status === 'number' && item.status >= 0 && item.status <= 1))
          && (item.rating === null || (typeof item.rating === 'number' && Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5))
          && typeof item.note === 'string'
      }
      if (!imported.every(isRecord)) throw new Error('invalid record')
      if (Capacitor.isNativePlatform()) {
        setPendingImport({ records: imported as RecordEntry[], presetColors: importedPresetColors })
        return
      }
      if (imported.length && !window.confirm(`将导入 ${imported.length} 条记录；相同 ID 的记录会被导入文件覆盖。继续吗？`)) return
      await applyImport(imported as RecordEntry[], importedPresetColors, 'overwrite')
    } catch {
      setMessage('导入失败：请选择 ShiJi 导出的有效 JSON 备份文件。')
    }
  }

  async function applyImport(imported: RecordEntry[], importedPresetColors: string[] | null, mode: 'merge' | 'overwrite') {
    setImporting(true)
    try {
      const existingRecords = mode === 'merge' ? await getRecords() : []
      const existingIds = new Set(existingRecords.map((record) => record.id))
      const recordsToImport = mode === 'merge' ? imported.filter((record) => !existingIds.has(record.id)) : imported
      const conflicts = imported.length - recordsToImport.length
      for (const record of recordsToImport) await saveRecord(record)
      setRecords(await getRecords())
      if (importedPresetColors) setPresetColors(importedPresetColors)
      setMessage(`已导入 ${recordsToImport.length} 条记录${conflicts ? `，保留本机 ${conflicts} 条同 ID 记录` : ''}`)
      setPendingImport(null)
      setConfirmOverwrite(false)
    } catch {
      setMessage('导入失败：请选择 ShiJi 导出的有效 JSON 备份文件。')
    } finally {
      setImporting(false)
    }
  }

  async function recordOnce() {
    if (!startAt || !endAt) {
      setMessage('请填写开始和结束时间。')
      return
    }
    try {
      const record: RecordEntry = {
        id: createRecordId(),
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        color,
        status,
        rating,
        note: note.trim(),
      }
      await saveRecord(record)
      setRecords((current) => [record, ...current])
      setMessage('已记录')
      const nextTime = toLocalInputValue(new Date())
      setSelectedDate(nextTime.slice(0, 10))
      setStartAt(nextTime)
      setEndAt(nextTime)
      setStatus(null)
      setRating(null)
      setColor('')
      setNote('')
      setNoteEditorOpen(false)
    } catch {
      setMessage('保存失败，请稍后重试。')
    }
  }

  function toggleTimer() {
    if (activeStart) {
      const end = new Date()
      setEndAt(`${selectedDate}T${toLocalInputValue(end).slice(11, 16)}`)
      setActiveStart(null)
      localStorage.removeItem('shiji-active-start')
      setMessage('计时结束；点击“记录一次”保存')
      return
    }
    const start = new Date()
    const value = start.toISOString()
    setSelectedDate(toLocalInputValue(start).slice(0, 10))
    setStartAt(toLocalInputValue(start))
    setActiveStart(value)
    localStorage.setItem('shiji-active-start', value)
    setMessage('计时已开始')
  }

  function beginRecordEdit(record: RecordEntry) {
    setEditingRecordId(record.id)
    setEditDraft({
      ...record,
      startAt: toLocalInputValue(new Date(record.startAt)),
      endAt: toLocalInputValue(new Date(record.endAt)),
    })
    setRecordListMessage('')
  }

  async function saveRecordEdit() {
    if (!editDraft) return
    const colorDigits = editDraft.color.trim().replace(/^#/, '').toUpperCase()
    if (colorDigits && !/^[0-9A-F]{6}$/.test(colorDigits)) {
      setRecordListMessage('颜色请输入 6 位 Hex 代码，例如 A96800；也可以留空。')
      return
    }
    try {
      const updatedRecord: RecordEntry = {
        ...editDraft,
        startAt: new Date(editDraft.startAt).toISOString(),
        endAt: new Date(editDraft.endAt).toISOString(),
        color: colorDigits ? `#${colorDigits}` : '',
      }
      await saveRecord(updatedRecord)
      setRecords((current) => current.map((record) => record.id === updatedRecord.id ? updatedRecord : record))
      setEditingRecordId(null)
      setEditDraft(null)
      setRecordListMessage('记录已更新。')
    } catch {
      setRecordListMessage('保存失败，请稍后重试。')
    }
  }

  async function removeRecord(record: RecordEntry) {
    if (!window.confirm('确定删除这条记录吗？此操作无法撤销。')) return
    try {
      await deleteRecord(record.id)
      setRecords((current) => current.filter((item) => item.id !== record.id))
      if (editingRecordId === record.id) {
        setEditingRecordId(null)
        setEditDraft(null)
      }
      setRecordListMessage('记录已删除。')
    } catch {
      setRecordListMessage('删除失败，请稍后重试。')
    }
  }

  function resetEntryFields() {
    setColor('')
    setStatus(null)
    setRating(null)
    setNote('')
    setNoteEditorOpen(false)
    setEditingHex(false)
    setHexDraft('')
  }

  function updateSelectedDate(nextDate: string) {
    if (!nextDate) return
    setSelectedDate(nextDate)
    setStartAt(`${nextDate}T${startAt.slice(11, 16)}`)
    setEndAt(`${nextDate}T${endAt.slice(11, 16)}`)
  }

  function setTimeValue(which: 'start' | 'end', time: string) {
    const value = `${selectedDate}T${time}`
    if (which === 'start') setStartAt(value)
    else setEndAt(value)
  }

  function recordsForDay(date: Date) {
    return recordsByDate.get(dateKey(date)) ?? []
  }

  function renderMonthView(date: Date, compact = false) {
    const days = monthGrid(date)
    return (
      <div className={compact ? 'mini-month' : 'month-view'}>
        {!compact && <div className="weekday-row">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>}
        <div className="month-grid">
          {days.map((day) => {
            const entries = recordsForDay(day)
            const isCurrentMonth = day.getMonth() === date.getMonth()
            const isToday = dateKey(day) === dateKey(new Date())
            if (compact) {
              return (
                <div className={`mini-day${isCurrentMonth ? '' : ' outside'}`} key={dateKey(day)}>
                  <span>{day.getDate()}</span>
                  {entries.length > 0 && <i style={{ backgroundColor: entries.find((entry) => entry.color)?.color ?? 'transparent' }} />}
                </div>
              )
            }
            return (
              <div className={`month-day${isCurrentMonth ? '' : ' outside'}${isToday ? ' today' : ''}`} key={dateKey(day)}>
                <span className="day-number">{day.getDate()}</span>
                <div className={`day-icons${entries.length > 1 ? ' multiple' : ''}`}>
                  {entries.map((entry) => <PoopIcon key={entry.id} color={entry.color} size={entries.length > 1 ? 14 : 21} spicy={entry.note.includes('#吃辣了')} />)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderWeekView() {
    const weekEntries = visibleRecords.filter((record) => {
      const start = new Date(record.startAt).getTime()
      const end = new Date(record.endAt).getTime()
      const weekStart = new Date(weekDates[0].getFullYear(), weekDates[0].getMonth(), weekDates[0].getDate()).getTime()
      const weekEnd = new Date(weekDates[6].getFullYear(), weekDates[6].getMonth(), weekDates[6].getDate() + 1).getTime()
      return end >= weekStart && start < weekEnd
    })
    const recordedHours = weekEntries.flatMap((record) => [new Date(record.startAt).getHours(), new Date(record.endAt).getHours()])
    let axisStartHour = recordedHours.length ? Math.max(0, Math.min(...recordedHours) - 1) : 7
    let axisEndHour = recordedHours.length ? Math.min(24, Math.max(...recordedHours) + 1) : 22
    if (axisEndHour - axisStartHour < 6) {
      const center = (axisStartHour + axisEndHour) / 2
      axisStartHour = Math.max(0, Math.floor(center - 3))
      axisEndHour = Math.min(24, axisStartHour + 6)
      axisStartHour = Math.max(0, axisEndHour - 6)
    }
    const axisHours = Math.max(6, axisEndHour - axisStartHour)
    const timelineHeight = 376
    const hourHeight = timelineHeight / axisHours
    const pixelsPerMinute = hourHeight / 60
    return (
      <div className="week-calendar">
        <div className="week-header">
          <span className="time-corner" />
          {weekDates.map((date, index) => (
            <div className={`week-day-heading${dateKey(date) === dateKey(new Date()) ? ' today' : ''}`} key={dateKey(date)}>
              <span>{weekDays[index]}</span><b>{date.getDate()}</b>
            </div>
          ))}
        </div>
        <div className="week-body" style={{ height: `${timelineHeight}px` }}>
          <div className="time-gutter">
            {Array.from({ length: axisHours }, (_, index) => {
              const hour = axisStartHour + index
              return <span key={hour} style={{ top: `${index * hourHeight}px` }}>{String(hour).padStart(2, '0')}:00</span>
            })}
          </div>
          <div className="week-columns">
            {weekDates.map((day) => {
              const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate())
              const nextDay = new Date(dayStart)
              nextDay.setDate(nextDay.getDate() + 1)
              const dayRecords = visibleRecords.filter((record) => {
                const start = new Date(record.startAt).getTime()
                const end = new Date(record.endAt).getTime()
                return end >= dayStart.getTime() && start < nextDay.getTime()
              })
              return (
                <div className="week-column" key={dateKey(day)}>
                  {Array.from({ length: axisHours + 1 }, (_, index) => <i className="hour-line" key={index} style={{ top: `${index * hourHeight}px` }} />)}
                  {dayRecords.map((record) => {
                    const start = new Date(record.startAt).getTime()
                    const end = new Date(record.endAt).getTime()
                    const segmentStart = Math.max(start, dayStart.getTime())
                    const segmentEnd = Math.min(end, nextDay.getTime())
                    const top = (((segmentStart - dayStart.getTime()) / 60_000) - axisStartHour * 60) * pixelsPerMinute
                    const height = Math.max(3, ((segmentEnd - segmentStart) / 60_000) * pixelsPerMinute)
                    const midpoint = start + (end - start) / 2
                    const midpointIsToday = midpoint >= dayStart.getTime() && midpoint < nextDay.getTime()
                    const iconTop = (((midpoint - dayStart.getTime()) / 60_000) - axisStartHour * 60) * pixelsPerMinute
                    return (
                      <div
                        className="week-event-fill"
                        key={`${record.id}-${dateKey(day)}`}
                        style={{ top: `${top}px`, height: `${height}px`, backgroundColor: record.color ? withAlpha(record.color, .18) : 'transparent' }}
                      >
                        {midpointIsToday && <PoopIcon className="week-event-icon" color={record.color} size={19} style={{ top: `${iconTop - top}px` }} spicy={record.note.includes('#吃辣了')} />}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  function renderRecordsSection(mode: 'recent' | 'all' | 'pwa') {
    const showingAll = mode === 'all' || (mode === 'pwa' && showAllRecords)
    const sectionRecords = showingAll
      ? Capacitor.isNativePlatform() ? [...visibleRecords].sort((a, b) => b.startAt.localeCompare(a.startAt)) : sortedRecords
      : [...visibleRecords].sort((a, b) => b.startAt.localeCompare(a.startAt)).slice(0, 5)
    const title = mode === 'pwa' ? (showAllRecords ? '全部记录' : '最近记录') : showingAll ? '全部记录' : '最近记录'
    const count = showingAll ? Capacitor.isNativePlatform() ? visibleRecords.length : records.length : visibleRecords.length

    return (
      <section className={`records-section${mode === 'recent' ? ' recent-records-section' : ''}`} id={mode === 'recent' ? 'recent-records' : 'records'} aria-label={title}>
        <div className="records-heading"><h2>{title}</h2><div className="records-heading-actions">
          {mode === 'pwa' && <button className="records-back-button" type="button" onClick={() => { setShowAllRecords((current) => !current); setRecordEditMode(false); setEditingRecordId(null); setEditDraft(null) }}>{showAllRecords ? '最近记录' : '全部记录'}</button>}
          <button className="records-back-button" type="button" onClick={() => { setRecordEditMode((current) => !current); setEditingRecordId(null); setEditDraft(null) }}>{recordEditMode ? '完成' : '编辑'}</button>
          <span className="record-count">{count} 条</span>
        </div></div>
        {recordListMessage && <p className="record-list-message" role="status">{recordListMessage}</p>}
        {sectionRecords.length === 0 ? (
          <div className="empty-state"><span className="empty-mark">✳</span><p>还没有记录</p><span>完成一次记录后，会显示在这里</span></div>
        ) : (
          <div className="record-list">{sectionRecords.map((record) => (
            <article className={`record-item${record.id.startsWith('sample-') ? ' sample-item' : ''}`} key={record.id}>
              <div className="record-summary">
                <PoopIcon color={record.color} size={22} />
                <div className="record-main"><div className="record-times">{Capacitor.isNativePlatform() ? <time>{formatNativeRecordTimes(record.startAt, record.endAt)}</time> : <><time>{formatDateTime(record.startAt)}</time><span>—</span><time>{formatDateTime(record.endAt)}</time></>}</div>{record.note && <p className="record-note">{record.note}</p>}</div>
                <div className="record-meta">{record.status !== null && <span>{record.status.toFixed(2)}</span>}{record.rating !== null && <span className="record-stars">{'★'.repeat(record.rating)}</span>}</div>
                {recordEditMode && !record.id.startsWith('sample-') && <div className="record-actions"><button type="button" onClick={() => beginRecordEdit(record)}>修改</button><button type="button" className="delete-record-button" onClick={() => void removeRecord(record)}>删除</button></div>}
              </div>
              {editingRecordId === record.id && editDraft && <div className="record-editor">
                <label>开始时间<input type="datetime-local" value={editDraft.startAt} onChange={(event) => setEditDraft({ ...editDraft, startAt: event.target.value })} /></label>
                <label>结束时间<input type="datetime-local" value={editDraft.endAt} onChange={(event) => setEditDraft({ ...editDraft, endAt: event.target.value })} /></label>
                <label>颜色 Hex<input type="text" value={editDraft.color.replace(/^#/, '')} onChange={(event) => setEditDraft({ ...editDraft, color: event.target.value.toUpperCase() })} /></label>
                <label>状态（0–1）<input type="number" min="0" max="1" step="0.01" value={editDraft.status ?? ''} onChange={(event) => setEditDraft({ ...editDraft, status: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                <label>评价<select value={editDraft.rating ?? ''} onChange={(event) => setEditDraft({ ...editDraft, rating: event.target.value === '' ? null : Number(event.target.value) })}><option value="">未评价</option>{[1, 2, 3, 4, 5].map((star) => <option key={star} value={star}>{star} 星</option>)}</select></label>
                <label className="record-editor-note">备注<textarea rows={2} value={editDraft.note} onChange={(event) => setEditDraft({ ...editDraft, note: event.target.value })} /></label>
                <div className="record-editor-actions"><button type="button" className="save-record-button" onClick={() => void saveRecordEdit()}>保存修改</button><button type="button" onClick={() => { setEditingRecordId(null); setEditDraft(null) }}>取消</button></div>
              </div>}
            </article>
          ))}</div>
        )}
      </section>
    )
  }

  return (
    <main className={`app-shell${Capacitor.isNativePlatform() ? ' native-app' : ''}`}>
      <header className="topbar">
        <button ref={menuButtonRef} className="icon-button" type="button" aria-label="打开菜单" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <span className="hamburger" aria-hidden="true"><i /><i /><i /></span>
        </button>
        <div className="brand">ShiJi</div>
        <button className="backup-button" type="button" onClick={downloadBackup} aria-label={`上次备份，${Capacitor.isNativePlatform() ? formatNativeBackupDateTime(lastBackup) : formatBackupDate(lastBackup)}`} disabled={!recordsLoaded}>
          {Capacitor.isNativePlatform() ? <>
            <span className="backup-datetime"><span>{formatNativeBackupDateTime(lastBackup).split(' ')[0]}</span><span>{formatNativeBackupDateTime(lastBackup).split(' ')[1] ?? ''}</span></span>
            <svg className="backup-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M4.5 15.5v4h15v-4" /></svg>
          </> : <>
            <span className="backup-icon" aria-hidden="true">↥</span>
            <span className="backup-label">上次备份</span>
            <span className="backup-date">{formatBackupDate(lastBackup)}</span>
          </>}
        </button>
        {menuOpen && <div ref={menuPopoverRef} className="menu-popover">{Capacitor.isNativePlatform() && <button type="button" aria-pressed={nativeDemoMode} onClick={() => { setNativeDemoMode((enabled) => !enabled); setMenuOpen(false); setRecordEditMode(false); setEditingRecordId(null); setEditDraft(null) }}>{nativeDemoMode ? '退出演示模式' : '演示模式'}</button>}<button type="button" onClick={openSharePanel}>分享</button><button type="button" onClick={chooseImportFile}>{Capacitor.isNativePlatform() ? '导入 JSON' : '导入数据'}</button><button className="menu-export-button" type="button" onClick={exportData}><span>{Capacitor.isNativePlatform() ? '导出 JSON' : '导出/备份'}</span><small>{Capacitor.isNativePlatform() ? '可保存到本机或 iCloud Drive' : lastBackup ? `上次 ${formatBackupDateTime(lastBackup)}` : '尚未备份'}</small></button></div>}
        <input ref={importFileRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importData} aria-label="选择备份文件导入" />
      </header>

      {shareOpen && <div className="share-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !sharing) setShareOpen(false) }}>
        <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
          <div className="share-dialog-heading"><h2 id="share-title">分享日历</h2><button type="button" aria-label="关闭" onClick={() => setShareOpen(false)}>×</button></div>
          <div className="share-mode-switch" role="group" aria-label="分享周期">
            {(['week', 'month', 'year'] as CalendarMode[]).map((mode) => <button key={mode} type="button" className={shareMode === mode ? 'active' : ''} aria-pressed={shareMode === mode} onClick={() => setShareMode(mode)}>{mode === 'week' ? '周' : mode === 'month' ? '月' : '年'}</button>)}
          </div>
          <div className="share-period-picker"><button type="button" aria-label="上一个周期" onClick={() => setShareDate((current) => shiftPeriod(current, shareMode, -1))}>‹</button><strong>{periodTitle(shareMode, shareDate)}</strong><button type="button" aria-label="下一个周期" onClick={() => setShareDate((current) => shiftPeriod(current, shareMode, 1))}>›</button><button type="button" className="share-current-button" onClick={() => setShareDate(new Date())}>现在</button></div>
          <label className="share-stats-option"><input type="checkbox" checked={shareIncludeStats} onChange={(event) => setShareIncludeStats(event.target.checked)} /><span>在图片中包含统计</span></label>
          <div className="share-preview" aria-label="分享图片实时预览"><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sharePreviewSvg)}`} alt={`${periodTitle(shareMode, shareDate)}分享图片预览`} /></div>
          <p className="share-hint">生成适合保存或发送的日历图片</p>
          <div className="share-dialog-actions"><button type="button" className="share-cancel-button" onClick={() => setShareOpen(false)} disabled={sharing}>取消</button><button type="button" className="share-generate-button" onClick={generateShareImage} disabled={sharing || !recordsLoaded}>{sharing ? '正在生成…' : '生成图片'}</button></div>
        </section>
      </div>}
      {pendingImport && <div className="share-overlay" role="presentation"><section className="share-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="share-dialog-heading"><h2 id="import-title">导入选项</h2><button type="button" aria-label="取消导入" disabled={importing} onClick={() => { setPendingImport(null); setConfirmOverwrite(false) }}>×</button></div><div className="import-stats"><div><span>已加载</span><strong>{records.length}</strong></div><div><span>导入文件</span><strong>{pendingImport.records.length}</strong></div><div><span>重复</span><strong>{new Set(pendingImport.records.map((item) => item.id).filter((id) => records.some((record) => record.id === id))).size}</strong></div></div><div className="import-choice-list"><button type="button" className="import-choice active" disabled={importing} onClick={() => void applyImport(pendingImport.records, pendingImport.presetColors, 'merge')}>合并</button><button type="button" className="import-choice" disabled={importing} onClick={() => setConfirmOverwrite(true)}>覆盖</button></div><div className="share-dialog-actions"><button type="button" disabled={importing} onClick={() => { setPendingImport(null); setConfirmOverwrite(false) }}>取消</button></div></section></div>}
      {pendingImport && confirmOverwrite && <div className="share-overlay import-warning-overlay" role="presentation"><section className="share-dialog" role="alertdialog" aria-modal="true" aria-labelledby="overwrite-title"><div className="share-dialog-heading"><h2 id="overwrite-title">确认覆盖记录</h2><button type="button" aria-label="返回导入选项" disabled={importing} onClick={() => setConfirmOverwrite(false)}>×</button></div><p className="import-warning-text">覆盖后，与导入文件中 ID 相同的现有记录将被替换，原记录无法找回。确定继续吗？</p><div className="share-dialog-actions"><button type="button" disabled={importing} onClick={() => setConfirmOverwrite(false)}>取消</button><button type="button" className="share-generate-button" disabled={importing} onClick={() => void applyImport(pendingImport.records, pendingImport.presetColors, 'overwrite')}>{importing ? '正在导入…' : '确认覆盖'}</button></div></section></div>}

      <div className={`native-page native-quick-page${nativeTab === 'quick' ? ' active' : ''}`}>
      <section className="composer" aria-label="快速记录">
        <div className="attributes">
          <div className="color-field">
            <div className="color-well" style={{ '--selected-color': color || hslToHex(hue, lightness) } as React.CSSProperties}>
              <div className="preset-row">
                <div className="preset-colors" aria-label="预选颜色">
                  {allPresetColors.map((swatch) => <button key={swatch} type="button" className={`preset-swatch${color === swatch ? ' selected' : ''}`} style={{ backgroundColor: swatch }} aria-label={`选择颜色 ${swatch}`} aria-pressed={color === swatch} onClick={() => chooseColor(swatch)} />)}
                  <button className="preset-manage-button" type="button" aria-label="编辑预设颜色" aria-expanded={presetEditorOpen} onClick={() => setPresetEditorOpen((open) => !open)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.8-.8 4 4-.8L19.8 7.4a2.1 2.1 0 0 0-3-3L4 16.8Z"/><path d="m14.9 6.4 3 3"/></svg></button>
                </div>
                <div className="color-code-row">
                  {editingHex ? (
                    <input autoFocus className="hex-editor" aria-label="输入 Hex 颜色代码" value={hexDraft} placeholder="#A96800" onChange={(event) => setHexDraft(event.target.value.toUpperCase())} onBlur={commitHex} onKeyDown={(event) => { if (event.key === 'Enter') commitHex() }} />
                  ) : (
                    <>
                      <button className="hex-edit-button" type="button" aria-label="编辑 Hex 颜色代码" onClick={() => { setHexDraft(color); setEditingHex(true) }}>✎</button>
                      <button className={`hex-value${color ? '' : ' empty'}`} type="button" aria-label="复制 Hex 颜色代码" title="点击复制 Hex" onClick={() => void copyCurrentHex()}>{color || 'HEX'}</button>
                    </>
                  )}
                </div>
              </div>
              {presetEditorOpen && <div className="preset-editor" role="dialog" aria-label="编辑预设颜色">
                <div className="preset-editor-heading"><strong>编辑预设颜色</strong><button type="button" aria-label="关闭预设颜色管理" onClick={() => setPresetEditorOpen(false)}>×</button></div>
                {presetColors.length ? <div className="custom-preset-list">{presetColors.map((preset) => <div className="custom-preset-item" key={preset}><button className="custom-preset-choice" type="button" onClick={() => { chooseColor(preset); setPresetEditorOpen(false) }}><i style={{ backgroundColor: preset }} />{preset}</button><button className="custom-preset-remove" type="button" aria-label={`删除预设颜色 ${preset}`} onClick={() => removePresetColor(preset)}>×</button></div>)}</div> : <p className="preset-editor-empty">暂无预设颜色</p>}
                <div className="preset-add-row"><i style={{ backgroundColor: color || hslToHex(hue, lightness) }} /><span>当前颜色 {color || hslToHex(hue, lightness)}</span><button type="button" onClick={addCurrentColorToPresets}>添加</button></div>
              </div>}
              <input className="hue-slider" aria-label="滑动选择色相，橙黄色范围更宽" type="range" min="0" max="100" value={hueToPosition(hue)} onChange={(event) => setHueColor(positionToHue(Number(event.target.value)))} />
              <input className="lightness-slider" aria-label="滑动选择明度" type="range" min="8" max="92" value={lightness} onChange={(event) => setColorLightness(Number(event.target.value))} />
            </div>
          </div>

          <div className="state-field field-card">
            <div className="state-labels"><span>上善若水</span><span>中庸之道</span><span>坚如磐石</span></div>
            <div className="state-control"><button className="state-endpoint" type="button" aria-label="清除状态" onClick={() => setStatus(null)}>○</button><input id="status" aria-label="状态" className="status-slider" type="range" min="0" max="1" step="0.01" value={status ?? 0.5} onChange={(event) => setStatus(Number(event.target.value))} /><button className="state-endpoint" type="button" aria-label="清除状态" onClick={() => setStatus(null)}>○</button></div>
          </div>

          <div className="rating-note-row">
            <div className="rating-field field-card">
              <div className="rating-scale" role="group" aria-label="评价顺畅程度"><span>艰难</span><div className="stars">{[1, 2, 3, 4, 5].map((star) => <button key={star} type="button" className={rating !== null && star <= rating ? 'star active' : 'star'} aria-label={`${star} 星`} aria-pressed={rating === star} onClick={() => setRating((current) => current === star ? null : star)}>★</button>)}</div><span>顺畅</span></div>
            </div>
            <button className={`quick-icon-button${note.includes('#吃辣了') ? ' active' : ''}`} type="button" aria-label="切换吃辣了标签" aria-pressed={note.includes('#吃辣了')} onClick={() => setNote((current) => current.includes('#吃辣了') ? current.replace(/\s*#吃辣了/, '').trim() : `${current}${current.trim() ? ' ' : ''}#吃辣了`)}><PepperIcon /></button>
            <button className={`quick-icon-button${note.trim() && !note.trim().startsWith('#吃辣了') ? ' active' : ''}`} type="button" aria-label="编辑备注" aria-expanded={noteEditorOpen} onClick={() => setNoteEditorOpen((open) => !open)}><NoteIcon /></button>
            {Capacitor.isNativePlatform() && <button className="quick-icon-button reset-entry-button" type="button" aria-label="重置颜色、状态、评分、吃辣标签和备注" onClick={resetEntryFields}><ResetIcon /></button>}
            {noteEditorOpen && <div className="note-editor-popover"><textarea autoFocus aria-label="备注" value={note.replace(/\s*#吃辣了/, '').trim()} onChange={(event) => setNote((current) => `${event.target.value}${current.includes('#吃辣了') ? `${event.target.value.trim() ? ' ' : ''}#吃辣了` : ''}`)} rows={3} placeholder="写点什么…" /><button type="button" onClick={() => setNoteEditorOpen(false)}>完成</button></div>}
          </div>
        </div>

        <div className="datetime-fields">
          <div className="date-control">
            <span className="date-month">{selectedDate.slice(5, 7)}</span>
            <span className="date-slash" aria-hidden="true">/</span>
            <span className="date-day">{selectedDate.slice(8, 10)}</span>
            <input type="date" aria-label="选择记录日期" value={selectedDate} onChange={(event) => updateSelectedDate(event.target.value)} />
          </div>
          <div className="time-fields">
            <label className="time-field"><span>开始</span><input type="time" value={startAt.slice(11, 16)} onChange={(event) => setTimeValue('start', event.target.value)} /></label>
            <label className="time-field"><span>结束</span><input type="time" value={endAt.slice(11, 16)} onChange={(event) => setTimeValue('end', event.target.value)} /></label>
          </div>
        </div>

        <div className="actions">
          <button className={`timer-button${activeStart ? ' running' : ''}`} type="button" aria-label={activeStart ? `停止计时，已计时${elapsedSeconds}秒` : '开始计时'} onClick={toggleTimer}>
            <span className="timer-dot" />{activeStart ? <span className="elapsed-time">{`${String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`}</span> : '开始计时'}
          </button>
          <button className="record-button" type="button" onClick={recordOnce}><span aria-hidden="true">＋</span>记录一次</button>
        </div>
        {message && <p className="feedback" role="status" aria-live="polite">{message}</p>}
      </section>

      {Capacitor.isNativePlatform() && renderRecordsSection('recent')}
      </div>

      <div className={`native-page native-calendar-page${nativeTab === 'calendar' ? ' active' : ''}`}>
      <section className="calendar-section" id="calendar" aria-label="日历">
        <div className="calendar-toolbar">
          <div className="calendar-period"><button type="button" aria-label="上一个周期" onClick={() => moveCalendar(-1)}>‹</button><strong>{calendarTitle}</strong><button type="button" aria-label="下一个周期" onClick={() => moveCalendar(1)}>›</button>{calendarMode !== 'week' && <button className="return-week-button" type="button" onClick={() => setCalendarDate(new Date())} disabled={calendarMode === 'month' ? isCurrentMonth : isCurrentYear}>{calendarMode === 'month' ? '本月' : '本年'}</button>}{calendarMode === 'week' && <button className="return-week-button" type="button" onClick={() => setCalendarDate(new Date())} disabled={isCurrentWeek}>本周</button>}<span className="calendar-total-count">共 {visibleRecords.length} 条</span></div>
          <div className="view-switcher" role="group" aria-label="日历视图">
            {(['week', 'month', 'year'] as CalendarMode[]).map((mode) => <button key={mode} type="button" className={calendarMode === mode ? 'active' : ''} aria-pressed={calendarMode === mode} onClick={() => setCalendarMode(mode)}>{mode === 'week' ? '周' : mode === 'month' ? '月' : '年'}</button>)}
          </div>
        </div>
        <div className="calendar-frame">
          {calendarMode === 'month' && renderMonthView(calendarDate)}
          {calendarMode === 'week' && renderWeekView()}
          {calendarMode === 'year' && <div className="year-grid">{Array.from({ length: new Date(calendarDate.getFullYear(), 1, 29).getMonth() === 1 ? 366 : 365 }, (_, dayIndex) => {
            const date = new Date(calendarDate.getFullYear(), 0, dayIndex + 1)
            const entries = recordsForDay(date)
            const monthStart = date.getDate() === 1
            const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日`
            const iconSize = entries.length > 1 ? Math.max(4, Math.min(8, 16 / Math.ceil(Math.sqrt(entries.length)))) : 24
            const dayClass = entries.length > 0 ? 'has-record' : 'empty'
            return <Fragment key={dateKey(date)}>
              {monthStart && <div className="year-month-label" aria-label={`${date.getMonth() + 1}月`}>{date.getMonth() + 1}</div>}
              <div className={`year-day ${dayClass}`} title={`${dateLabel}${entries.length ? ` · ${entries.length}条记录` : ''}`} aria-label={`${dateLabel}${entries.length ? `，${entries.length}条记录` : '，无记录'}`}>
                {entries.length > 0 && <div className={`year-day-icons${entries.length > 1 ? ' multiple' : ''}`}>{entries.map((entry) => <PoopIcon key={entry.id} color={entry.color} size={iconSize} spicy={entry.note.includes('#吃辣了')} />)}</div>}
              </div>
            </Fragment>
          })}</div>}
        </div>
      </section>

      <section className="statistics-section" aria-label="周期平均">
        <div className="statistics-heading"><h2>{calendarMode === 'week' ? '本周平均' : calendarMode === 'month' ? '本月平均' : '本年平均'}</h2><span>{statistics.count} 条记录</span></div>
        {statistics.count === 0 ? <p className="statistics-empty">这个周期还没有记录</p> : <div className="statistics-grid" style={{ '--average-color': statistics.averageColor ?? '#A96800' } as React.CSSProperties}>
          <article className="stat-card"><span className="stat-label"><small>{statistics.colorCount} 条有颜色</small></span>{statistics.averageColor ? <div className="stat-color"><i style={{ backgroundColor: statistics.averageColor }} /><b>{statistics.averageColor}</b></div> : <strong className="stat-unset">暂无颜色数据</strong>}</article>
          <article className="stat-card"><span className="stat-label"><small>{statistics.statusCount} 条有状态</small></span>{statistics.averageStatus !== null ? <><div className="stat-meter"><PoopIcon className="stat-meter-icon" color={statistics.averageColor ?? ''} size={18} style={{ left: `${statistics.averageStatus * 100}%` }} /></div><div className="stat-endpoints"><span>上善若水</span><span>坚如磐石</span></div></> : <strong className="stat-unset">暂无状态数据</strong>}</article>
          <article className="stat-card"><span className="stat-label"><small>{statistics.ratingCount} 条有评价</small></span>{statistics.averageRating !== null ? <div className="stat-caption"><span>艰难</span><span className="stat-caption-stars" role="img" aria-label={`${statistics.averageRating.toFixed(1)} 星`}>{Array.from({ length: 5 }, (_, index) => {
            const fill = Math.max(0, Math.min(1, statistics.averageRating! - index)) * 100
            return <span className="stat-caption-star" key={index} style={{ background: `linear-gradient(90deg,var(--average-color) ${fill}%,#d8d2c8 ${fill}%)` }}>★</span>
          })}</span><span>顺畅</span></div> : <strong className="stat-unset">暂无评价数据</strong>}</article>
        </div>}
      </section>
      </div>

      <div className={`native-page native-records-page${nativeTab === 'records' ? ' active' : ''}`}>
      {Capacitor.isNativePlatform() ? renderRecordsSection('all') : renderRecordsSection('pwa')}
      </div>
      <footer className="app-footer">ShiJi <span>·</span> 个人记录</footer>

      {Capacitor.isNativePlatform() && <nav className="native-tabbar" role="tablist" aria-label="主导航">
        {([['quick', '快速记录'], ['calendar', '查看日历'], ['records', '全部记录']] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" className={`native-tab${nativeTab === tab ? ' active' : ''}`} aria-label={label} aria-selected={nativeTab === tab} onClick={() => setNativeTab(tab)}>
          <NativeTabIcon tab={tab} />
        </button>)}
      </nav>}
    </main>
  )
}

export default App
