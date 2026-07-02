// GitHub-style contribution heatmap of deployment activity, one full
// calendar year (Jan–Dec) at a time. Switch years with the chips.

import { useMemo, useState } from 'react'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// How many past years the chips reach back (plus the current year).
const YEARS_BACK = 5

function dayKey(d) {
  return d.toISOString().slice(0, 10)
}

function level(count) {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 9) return 3
  return 4
}

export default function ContributionGraph({ events }) {
  const currentYear = new Date().getUTCFullYear()
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => currentYear - i)
  const [year, setYear] = useState(currentYear)

  // Tally deployments per UTC day (independent of the selected year).
  const counts = useMemo(() => {
    const m = new Map()
    for (const e of events) {
      if (!e?.date) continue
      const key = e.date.slice(0, 10)
      m.set(key, (m.get(key) || 0) + 1)
    }
    return m
  }, [events])

  // Build a Sun-aligned grid covering Jan 1 – Dec 31 of the selected year.
  const { weeks, monthLabels, total } = useMemo(() => {
    const now = new Date()
    const todayKey = dayKey(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    )

    const start = new Date(Date.UTC(year, 0, 1))
    start.setUTCDate(start.getUTCDate() - start.getUTCDay()) // back to Sunday
    const end = new Date(Date.UTC(year, 11, 31))
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay())) // forward to Saturday

    const weeks = []
    let total = 0
    const cursor = new Date(start)
    while (cursor <= end) {
      const week = []
      for (let d = 0; d < 7; d++) {
        const key = dayKey(cursor)
        const inYear = cursor.getUTCFullYear() === year
        const count = counts.get(key) || 0
        if (inYear) total += count
        week.push({
          key,
          date: new Date(cursor),
          count,
          inYear,
          future: key > todayKey,
        })
        cursor.setUTCDate(cursor.getUTCDate() + 1)
      }
      weeks.push(week)
    }

    // Month labels: mark the week where an in-year month first appears.
    const monthLabels = weeks.map((week, i) => {
      const first = week.find((day) => day.inYear)
      if (!first) return null
      const prev = i > 0 ? weeks[i - 1].find((day) => day.inYear) : null
      if (!prev || first.date.getUTCMonth() !== prev.date.getUTCMonth()) {
        return { index: i, label: MONTHS[first.date.getUTCMonth()] }
      }
      return null
    })

    return { weeks, monthLabels, total }
  }, [counts, year])

  return (
    <div className="graph-card">
      <div className="graph-header">
        <h2>
          <span className="accent">{total.toLocaleString()}</span> deployments in {year}
        </h2>
        <div className="year-chips">
          {years.map((y) => (
            <button
              key={y}
              className={`chip${y === year ? ' chip-active' : ''}`}
              onClick={() => setYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="graph-inner">
        <div
          className="month-row"
          style={{ gridTemplateColumns: `30px repeat(${weeks.length}, 1fr)` }}
        >
          {monthLabels.map((m, i) =>
            m ? (
              <span key={i} className="month-label" style={{ gridColumn: m.index + 2 }}>
                {m.label}
              </span>
            ) : null,
          )}
        </div>

        <div className="graph-body">
          <div className="weekday-col">
            {WEEKDAYS.map((d, i) => (
              <span key={d} className="weekday-label">
                {i % 2 === 1 ? d : ''}
              </span>
            ))}
          </div>

          <div
            className="weeks"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }}
          >
            {weeks.map((week, wi) => (
              <div key={wi} className="week">
                {week.map((day) =>
                  !day.inYear || day.future ? (
                    <div key={day.key} className="cell cell-future" />
                  ) : (
                    <div
                      key={day.key}
                      className={`cell cell-l${level(day.count)}`}
                      title={`${day.count} deployment${day.count === 1 ? '' : 's'} on ${day.key}`}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="legend">
        <span>Less</span>
        <div className="cell cell-l0" />
        <div className="cell cell-l1" />
        <div className="cell cell-l2" />
        <div className="cell cell-l3" />
        <div className="cell cell-l4" />
        <span>More</span>
      </div>
    </div>
  )
}
