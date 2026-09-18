import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import SettingsPage from './SettingsPage'
import { LocaleProvider } from '../../shared/localization/LocaleProvider'
import i18n from '../../shared/localization/i18n'
import { ThemeProvider } from '../../shared/theme/ThemeProvider'
import { THEME_STORAGE_KEY } from '../../shared/theme/theme'

describe('Settings supported account and appearance behavior', () => {
  beforeEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage('en')
    document.documentElement.removeAttribute('data-theme')
  })

  it('shows read-only account identity without account-management controls', () => {
    render(<ThemeProvider><LocaleProvider><SettingsPage email="person@example.com" /></LocaleProvider></ThemeProvider>)

    expect(screen.getByText('person@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Appearance',
      'Language',
      'Account',
    ])
    expect(screen.getByText('Signed-in email').tagName).toBe('DT')
  })

  it('uses the existing theme preference and persistence behavior', async () => {
    const user = userEvent.setup()
    render(<ThemeProvider><LocaleProvider><SettingsPage email="person@example.com" /></LocaleProvider></ThemeProvider>)
    const control = screen.getByRole('combobox', { name: 'Theme preference' })

    expect(control).toHaveValue('system')
    expect(screen.getByText('System follows your device. Light or Dark is saved on this device.')).toBeInTheDocument()

    await user.selectOptions(control, 'dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')

    await user.selectOptions(control, 'system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(document.documentElement).not.toHaveAttribute('data-theme')
  })

  it('persists the language preference and translates Settings without changing account data', async () => {
    const user = userEvent.setup()
    render(<ThemeProvider><LocaleProvider><SettingsPage email="person@example.com" /></LocaleProvider></ThemeProvider>)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language preference' }), 'es')

    expect(screen.getByRole('heading', { name: 'Configuración', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Preferencia de idioma' })).toHaveValue('es')
    expect(screen.getByRole('combobox', { name: 'Preferencia de tema' })).toHaveValue('system')
    expect(screen.getByText('person@example.com')).toBeInTheDocument()
    expect(localStorage.getItem('ordo-language')).toBe('es')
  })
})
