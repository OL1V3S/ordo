import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MorePage from './MorePage'
import { LocaleProvider } from '../../shared/localization/LocaleProvider'
import i18n from '../../shared/localization/i18n'

describe('More navigation hub', () => {
  beforeEach(async () => i18n.changeLanguage('en'))
  afterEach(() => vi.unstubAllGlobals())

  it('puts Settings first and keeps the Investing placeholder subordinate and explicit', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<LocaleProvider><MemoryRouter><MorePage /></MemoryRouter></LocaleProvider>)

    expect(screen.getByRole('heading', { name: 'More', level: 1 })).toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/settings', '/investing'])
    const investingLink = screen.getByRole('link', { name: /Investing/ })
    expect(investingLink).toHaveAttribute('href', '/investing')
    expect(investingLink).toHaveTextContent(/unavailable/i)
    expect(screen.getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/settings')
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('renders localized secondary labels while preserving destination paths', async () => {
    await i18n.changeLanguage('es')
    render(<LocaleProvider><MemoryRouter><MorePage /></MemoryRouter></LocaleProvider>)

    expect(screen.getByRole('heading', { name: 'Más', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Configuración/ })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('link', { name: /Inversiones/ })).toHaveAttribute('href', '/investing')
    expect(screen.getByText('No disponible')).toBeInTheDocument()
  })
})
