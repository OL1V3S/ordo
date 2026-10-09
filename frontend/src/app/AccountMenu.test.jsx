import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountMenu from './AccountMenu'
import { LocaleProvider } from '../shared/localization/LocaleProvider'
import i18n from '../shared/localization/i18n'
import { ThemeProvider } from '../shared/theme/ThemeProvider'

function renderMenu(ui, path = '/overview') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider><LocaleProvider>{ui}<button>Outside</button></LocaleProvider></ThemeProvider>
    </MemoryRouter>,
  )
}

describe('AccountMenu', () => {
  beforeEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage('en')
  })

  it('toggles aria-expanded and controls the panel', async () => {
    const user = userEvent.setup()
    renderMenu(<AccountMenu variant="bar" email="a@example.com" onLogout={vi.fn()} panelId="panel-a" />)
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-controls', 'panel-a')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('panel-a')).toBeInTheDocument()
    await user.click(trigger)
    expect(document.getElementById('panel-a')).toBeNull()
  })

  it('closes on Escape from a panel link and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderMenu(<AccountMenu variant="bar" email="a@example.com" onLogout={vi.fn()} panelId="panel-a" />)
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    await user.click(trigger)
    await user.tab()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on an outside pointerdown without moving focus into the panel', async () => {
    const user = userEvent.setup()
    renderMenu(<AccountMenu variant="bar" email="a@example.com" onLogout={vi.fn()} panelId="panel-a" />)
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(document.activeElement === document.body || document.activeElement === screen.getByRole('button', { name: 'Account menu' })).toBe(true)
  })

  it('closes when Tab moves focus past the last control', async () => {
    const user = userEvent.setup()
    renderMenu(<AccountMenu variant="bar" email="a@example.com" onLogout={vi.fn()} panelId="panel-a" />)
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    within(screen.getByRole('group')).getByRole('button', { name: 'Logout' }).focus()
    await user.tab()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
  })

  it('closes on link click and returns focus to the trigger for the current path', async () => {
    const user = userEvent.setup()
    renderMenu(<AccountMenu variant="bar" email="a@example.com" onLogout={vi.fn()} panelId="panel-a" />, '/settings')
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    await user.click(trigger)
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('names the sidebar trigger from its visible text and email', () => {
    renderMenu(<AccountMenu variant="sidebar" email="a@example.com" onLogout={vi.fn()} panelId="panel-s" />)
    const trigger = screen.getByRole('button', { name: /^Account/ })
    expect(trigger).toHaveAccessibleName('Account a@example.com')
    expect(trigger).not.toHaveAccessibleName('Account menu')
  })

  it('keeps ids and labels unique across two instances', async () => {
    const user = userEvent.setup()
    renderMenu(<>
      <AccountMenu variant="bar" email="a@example.com" onLogout={vi.fn()} panelId="panel-a" />
      <AccountMenu variant="sidebar" email="a@example.com" onLogout={vi.fn()} panelId="panel-s" />
    </>)
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('button', { name: /^Account a@/ }))
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
