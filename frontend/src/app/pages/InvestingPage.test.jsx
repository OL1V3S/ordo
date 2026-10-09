import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InvestingPage from './InvestingPage'
import i18n from '../../shared/localization/i18n'

describe('Investing unavailable surface', () => {
  beforeEach(() => i18n.changeLanguage('en'))
  afterEach(() => vi.unstubAllGlobals())

  it('describes only unconnected, unavailable, source-neutral future domains', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<InvestingPage />)

    expect(screen.getByRole('heading', { name: 'No investment source connected' })).toBeInTheDocument()
    expect(screen.getByText(/No investment data is being fetched, imported, inferred, or evaluated/)).toBeInTheDocument()

    const capabilities = screen.getByRole('heading', { name: 'Planned capability areas' }).closest('section')
    expect(within(capabilities).getByRole('heading', { name: 'Connections' })).toBeInTheDocument()
    expect(within(capabilities).getByRole('heading', { name: 'Portfolio and positions' })).toBeInTheDocument()
    expect(within(capabilities).getByRole('heading', { name: 'Signals' })).toBeInTheDocument()
    expect(within(capabilities).getByRole('heading', { name: 'Activity and performance' })).toBeInTheDocument()
    expect(within(capabilities).getAllByText('Not available')).toHaveLength(4)
    expect(screen.getByText(/source-specific adapter and a normalized application contract/)).toBeInTheDocument()
    expect(screen.getByText(/No provider is supported today/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('exposes named regions and a four-item capability list', () => {
    render(<InvestingPage />)

    expect(screen.getByRole('region', { name: 'No investment source connected' })).toBeInTheDocument()
    const capabilities = screen.getByRole('region', { name: 'Planned capability areas' })
    expect(within(capabilities).getAllByRole('listitem')).toHaveLength(4)
  })

  it('renders in Spanish without buttons or fetches', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await i18n.changeLanguage('es')
    render(<InvestingPage />)

    expect(screen.getByRole('heading', { name: 'Inversiones', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No hay ninguna fuente de inversiones conectada' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Conexiones', level: 3 })).toBeInTheDocument()
    expect(screen.getAllByText('No disponible')).toHaveLength(4)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
