import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../../shared/theme/ThemeProvider'
import { THEME_STORAGE_KEY } from '../../shared/theme/theme'
import i18n from '../../shared/localization/i18n'
import SpendingChart from './SpendingChart'

vi.mock('react-chartjs-2', () => ({
  Bar: ({ data, options }) => (
    <>
      <pre data-testid="chart-data">{JSON.stringify(data)}</pre>
      <pre data-testid="chart-options">{JSON.stringify(options)}</pre>
    </>
  ),
}))

const lightColors = {
  '--chart-spent': '#5458c9',
  '--chart-limit': '#666873',
  '--chart-text': '#181a20',
  '--chart-grid': '#e7e8ec',
  '--chart-border': '#8b8d94',
  '--chart-surface': '#ffffff',
}

const darkColors = {
  '--chart-spent': '#8d91ff',
  '--chart-limit': '#a1a4ad',
  '--chart-text': '#f3f3f0',
  '--chart-grid': '#242938',
  '--chart-border': '#666c7d',
  '--chart-surface': '#151923',
}

function createSystemThemeMock() {
  const listeners = new Set()
  const query = {
    matches: false,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((event, listener) => {
      if (event === 'change') listeners.add(listener)
    }),
    removeEventListener: vi.fn((event, listener) => {
      if (event === 'change') listeners.delete(listener)
    }),
    setMatches(matches) {
      query.matches = matches
      listeners.forEach((listener) => listener({ matches, media: query.media }))
    },
  }

  return query
}

function chartData() {
  return JSON.parse(screen.getByTestId('chart-data').textContent)
}

function chartOptions() {
  return JSON.parse(screen.getByTestId('chart-options').textContent)
}

describe('spending chart data', () => {
  let systemTheme

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.removeItem(THEME_STORAGE_KEY)
    systemTheme = createSystemThemeMock()

    vi.stubGlobal('matchMedia', vi.fn(() => systemTheme))
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      getPropertyValue(property) {
        const explicitTheme = document.documentElement.dataset.theme
        const colors = explicitTheme === 'dark' || (!explicitTheme && systemTheme.matches)
          ? darkColors
          : lightColors
        return colors[property] ?? ''
      },
    }))
  })

  afterEach(async () => {
    await act(async () => { await i18n.changeLanguage('en') })
    document.documentElement.removeAttribute('data-theme')
    localStorage.removeItem(THEME_STORAGE_KEY)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('unions spending and limit categories once and keeps both datasets aligned', () => {
    render(<SpendingChart
      totalsByCategory={{ food: 25, transport: 10 }}
      budgetLimitsByCategory={{
        food: { limitAmount: 100 },
        bills: { limitAmount: 80 },
      }}
    />)

    const data = chartData()
    expect(data.labels).toEqual(['Food', 'Transport', 'Bills'])
    expect(data.datasets[0]).toMatchObject({ label: 'Spent', data: [25, 10, 0] })
    expect(data.datasets[1]).toMatchObject({ label: 'Budget Limit', data: [100, 0, 80] })

    expect(screen.getByTestId('chart-data').parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('heading', { name: 'Spending and budget limit data' })).toBeInTheDocument()

    const foodRow = screen.getByText('Food').closest('li')
    expect(foodRow).toHaveTextContent('Spent: $25.00')
    expect(foodRow).toHaveTextContent('Budget limit: $100.00')

    const transportRow = screen.getByText('Transport').closest('li')
    expect(transportRow).toHaveTextContent('Spent: $10.00')
    expect(transportRow).toHaveTextContent('Budget limit: $0.00')

    const billsRow = screen.getByText('Bills').closest('li')
    expect(billsRow).toHaveTextContent('Spent: $0.00')
    expect(billsRow).toHaveTextContent('Budget limit: $80.00')
  })

  it('localizes known and uncategorized keys in labels and the data summary and keeps a custom category as before', async () => {
    const totals = { food: 25, bills: 10, uncategorized: 5, 'home repair': 3 }
    const { rerender } = render(<SpendingChart totalsByCategory={totals} budgetLimitsByCategory={{}} />)
    expect(chartData().labels).toEqual(['Food', 'Bills', 'Uncategorized', 'Home Repair'])

    await act(async () => { await i18n.changeLanguage('es') })
    rerender(<SpendingChart totalsByCategory={totals} budgetLimitsByCategory={{}} />)
    expect(chartData().labels).toEqual(['Comida', 'Servicios', 'Sin categoría', 'Home Repair'])
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.querySelector('strong').textContent)).toEqual(['Comida', 'Servicios', 'Sin categoría', 'Home Repair'])
  })

  it('shows the existing empty state when neither input contains categories', () => {
    render(<SpendingChart totalsByCategory={{}} budgetLimitsByCategory={{}} />)
    expect(screen.getByText('No data to display chart.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Spending and budget limit data' })).not.toBeInTheDocument()
  })

  it('recolors the canvas when the explicit root theme changes', async () => {
    document.documentElement.dataset.theme = 'light'
    render(<SpendingChart totalsByCategory={{ food: 25 }} budgetLimitsByCategory={{ food: { limitAmount: 100 } }} />)

    await waitFor(() => {
      expect(chartData().datasets.map(({ backgroundColor }) => backgroundColor)).toEqual([
        lightColors['--chart-spent'],
        lightColors['--chart-limit'],
      ])
    })

    const valuesBeforeThemeChange = chartData().datasets.map(({ data }) => data)

    act(() => {
      document.documentElement.dataset.theme = 'dark'
    })

    await waitFor(() => {
      expect(chartData().datasets.map(({ backgroundColor }) => backgroundColor)).toEqual([
        darkColors['--chart-spent'],
        darkColors['--chart-limit'],
      ])
    })

    expect(chartData().datasets.map(({ data }) => data)).toEqual(valuesBeforeThemeChange)
    expect(chartOptions()).toMatchObject({
      scales: {
        x: {
          ticks: { color: darkColors['--chart-text'] },
          grid: { color: darkColors['--chart-grid'] },
          border: { color: darkColors['--chart-border'] },
        },
        y: {
          ticks: { color: darkColors['--chart-text'] },
          grid: { color: darkColors['--chart-grid'] },
          border: { color: darkColors['--chart-border'] },
        },
      },
      plugins: {
        legend: { labels: { color: darkColors['--chart-text'] } },
        tooltip: {
          titleColor: darkColors['--chart-text'],
          bodyColor: darkColors['--chart-text'],
          backgroundColor: darkColors['--chart-surface'],
          borderColor: darkColors['--chart-border'],
        },
      },
    })
  })

  it('recolors the canvas when the system color preference changes', async () => {
    render(<SpendingChart totalsByCategory={{ food: 25 }} budgetLimitsByCategory={{}} />)

    await waitFor(() => {
      expect(chartData().datasets[0].backgroundColor).toBe(lightColors['--chart-spent'])
    })

    act(() => systemTheme.setMatches(true))

    await waitFor(() => {
      expect(chartData().datasets[0].backgroundColor).toBe(darkColors['--chart-spent'])
      expect(chartOptions().scales.y.ticks.color).toBe(darkColors['--chart-text'])
    })
  })

  it('reads a stored theme after ThemeProvider applies it on mount', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    render(
      <ThemeProvider>
        <SpendingChart totalsByCategory={{ food: 25 }} budgetLimitsByCategory={{}} />
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
      expect(chartData().datasets[0].backgroundColor).toBe(darkColors['--chart-spent'])
    })
  })

  it('cleans up root and system theme subscriptions on unmount', async () => {
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const { unmount } = render(
      <SpendingChart totalsByCategory={{ food: 25 }} budgetLimitsByCategory={{}} />
    )

    await waitFor(() => {
      expect(systemTheme.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    })

    const changeListener = systemTheme.addEventListener.mock.calls[0][1]
    const disconnectCallsBeforeUnmount = disconnectSpy.mock.calls.length
    unmount()

    expect(disconnectSpy).toHaveBeenCalledTimes(disconnectCallsBeforeUnmount + 1)
    expect(systemTheme.removeEventListener).toHaveBeenCalledWith('change', changeListener)
  })
})
