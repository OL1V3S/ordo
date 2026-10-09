import { StrictMode, useState } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { AxiosError } from 'axios'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { LocaleProvider } from '../shared/localization/LocaleProvider'
import i18n from '../shared/localization/i18n'
import { ThemeProvider } from '../shared/theme/ThemeProvider'
import client from '../shared/api/client'
import { authApi } from '../shared/api/authApi'

vi.mock('../features/transactions/pages/TransactionsPage', () => ({
  default: function TransactionsWorkspace() {
    const [dataOwner] = useState(() => localStorage.getItem('email'))
    const [draft, setDraft] = useState('')
    return <>
      <h1>Transactions workspace</h1>
      <p>Loaded transactions for {dataOwner}</p>
      <input aria-label="Transaction draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    </>
  },
}))

vi.mock('../features/budgetLimits/pages/BudgetsPage', () => ({
  default: () => <h1>Budgets workspace</h1>,
}))

vi.mock('../features/analytics/pages/AnalyticsPage', () => ({
  default: () => <h1>Analytics workspace</h1>,
}))

vi.mock('../features/commitments/pages/CommitmentsPage', () => ({
  default: () => <h1>Commitments workspace</h1>,
}))

vi.mock('../features/paychecks/pages/PaychecksPage', () => ({
  default: () => <h1>Paychecks workspace</h1>,
}))

vi.mock('./pages/OverviewPage', () => ({
  default: () => <h1>Welcome back</h1>,
}))

vi.mock('../features/auth/components/AuthPage', () => ({
  default: () => <h1>Authentication content</h1>,
}))

vi.mock('../features/auth/components/ConfirmEmailPage', () => ({
  default: () => <h1>Confirmation content</h1>,
}))

vi.mock('../features/auth/components/ForgotPasswordPage', () => ({
  default: () => <h1>Forgot password content</h1>,
}))

vi.mock('../features/auth/components/ResetPasswordPage', () => ({
  default: () => <h1>Reset password content</h1>,
}))

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <span data-testid="location">{location.pathname}</span>
    <button onClick={() => navigate(-1)}>Test history back</button>
    <button onClick={() => navigate(1)}>Test history forward</button>
  </>
}

function renderAt(path, { strict = false } = {}) {
  const application = <ThemeProvider><LocaleProvider><App /><LocationProbe /></LocaleProvider></ThemeProvider>
  return render(
    <MemoryRouter initialEntries={[path]}>
      {strict ? <StrictMode>{application}</StrictMode> : application}
    </MemoryRouter>,
  )
}

function rejectSession(config) {
  return Promise.reject(new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST,
    config, undefined, { status: 401, data: {}, headers: {}, config }))
}

const originalAdapter = client.defaults.adapter

describe('application routes and shell', () => {
  beforeEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage('en')
    vi.stubGlobal('scrollTo', vi.fn())
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    client.defaults.adapter = originalAdapter
    vi.unstubAllGlobals()
  })

  it('shows the existing authentication experience at the root without a token', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument()
  })

  it('redirects an authenticated root visit to overview', async () => {
    localStorage.setItem('token', 'jwt-value')
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/overview')
    expect(screen.getAllByText('ordo')).toHaveLength(2)
  })

  it.each(['/transactions', '/paychecks', '/plan', '/more'])('redirects protected %s to authentication without a token', async (path) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it.each([
    ['/overview', 'Welcome back'],
    ['/transactions', 'Transactions workspace'],
    ['/budgets', 'Budgets workspace'],
    ['/analytics', 'Analytics workspace'],
    ['/plan', 'Plan'],
    ['/more', 'More'],
    ['/commitments', 'Commitments workspace'],
    ['/paychecks', 'Paychecks workspace'],
    ['/investing', 'Investing'],
    ['/settings', 'Settings'],
  ])('supports direct authenticated navigation to %s', async (path, heading) => {
    localStorage.setItem('token', 'jwt-value')
    localStorage.setItem('email', 'person@example.com')
    renderAt(path)
    expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument()
  })

  it.each([
    ['/overview', 'Home'], ['/transactions', 'Activity'], ['/analytics', 'Insights'],
  ])('uses the same customer label in the primary navigation and the pagebar for %s', (path, label) => {
    localStorage.setItem('token', 'jwt-value')
    renderAt(path)
    const link = within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', { name: new RegExp(label) })
    expect(link).toHaveAttribute('href', path)
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByRole('banner')).getByText(label)).toBeVisible()
  })

  it('provides a keyboard skip link to the main content', () => {
    localStorage.setItem('token', 'jwt-value')
    renderAt('/overview')

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content')
    expect(document.getElementById('main-content')).toHaveAttribute('id', 'main-content')
  })

  it('exposes four primary destinations with Plan children in one navigation landmark', () => {
    localStorage.setItem('token', 'jwt-value')
    renderAt('/overview')
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    const topLevel = [...navigation.querySelectorAll('.app-nav__list > li > a')]
    expect(topLevel.map((link) => link.getAttribute('href'))).toEqual(['/overview', '/transactions', '/plan', '/analytics'])
    for (const label of ['Home', 'Activity', 'Plan', 'Insights']) {
      const link = within(navigation).getByRole('link', { name: label })
      expect(within(link).getByText(label, { selector: 'span' })).toBeInTheDocument()
    }
    expect([...navigation.querySelectorAll('a')].map((link) => link.getAttribute('href')))
      .toEqual(['/overview', '/transactions', '/plan', '/budgets', '/commitments', '/paychecks', '/analytics'])
    expect(screen.queryByRole('navigation', { name: 'Secondary navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('link', { name: /Settings/ })).toHaveLength(0)
    expect(document.querySelector('a[href="/more"]')).toBeNull()
  })

  it('opens Paychecks through desktop navigation and marks the Plan group current', async () => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'jwt-value')
    renderAt('/overview')
    await user.click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', { name: /Paychecks/ }))
    expect(await screen.findByRole('heading', { name: 'Paychecks workspace' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', { name: /Paychecks/ })).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'location')
  })

  it.each([
    ['/overview', 'Home', 'page'], ['/transactions', 'Activity', 'page'],
    ['/plan', 'Plan', 'page'], ['/budgets', 'Plan', 'location'],
    ['/commitments', 'Plan', 'location'], ['/paychecks', 'Plan', 'location'],
    ['/paychecks/?source=bookmark', 'Plan', 'location'], ['/analytics', 'Insights', 'page'],
  ])('marks only the correct primary destination for %s', (path, label, current) => {
    localStorage.setItem('token', 'synthetic-session')
    renderAt(path)
    const primary = screen.getByRole('navigation', { name: 'Primary navigation' })
    const marked = [...primary.querySelectorAll('[aria-current]')]
    expect(marked.filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
    expect(within(primary).getByRole('link', { name: label })).toHaveAttribute('aria-current', current)
  })

  it.each(['/more', '/investing', '/settings'])('marks no primary destination for %s', (path) => {
    localStorage.setItem('token', 'synthetic-session')
    renderAt(path)
    expect(screen.getByRole('navigation', { name: 'Primary navigation' }).querySelectorAll('[aria-current]')).toHaveLength(0)
  })

  it.each([
    ['/budgets', 'Plan', '/plan'], ['/commitments', 'Plan', '/plan'], ['/paychecks', 'Plan', '/plan'],
  ])('provides a deterministic parent link for direct bookmark %s', async (path, parent, target) => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'synthetic-session')
    renderAt(path)
    const main = screen.getByRole('main')
    const link = within(main).getByRole('link', { name: parent })
    expect(link).toHaveAttribute('href', target)
    await user.click(link)
    expect(within(main).getByRole('heading', { level: 1, name: parent })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(target)
    expect(main).toHaveFocus()
  })

  it.each(['/investing', '/settings'])('renders no parent link in the page content for %s', (path) => {
    localStorage.setItem('token', 'synthetic-session')
    renderAt(path)
    expect(document.querySelector('.mobile-parent-link')).toBeNull()
  })

  it('navigates hubs and history with main focus, and opens Settings from the Account menu', async () => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'synthetic-session')
    renderAt('/overview')
    const mobile = screen.getByRole('navigation', { name: 'Primary navigation' })
    const main = screen.getByRole('main')
    window.scrollTo.mockClear()
    await user.click(within(mobile).getByRole('link', { name: 'Plan' }))
    expect(main).toHaveFocus()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    window.scrollTo.mockClear()
    await user.click(within(main).getByRole('link', { name: /Paychecks/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/paychecks')
    expect(main).toHaveFocus()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    window.scrollTo.mockClear()
    await user.click(screen.getByRole('button', { name: 'Test history back' }))
    expect(within(main).getByRole('heading', { name: 'Plan', level: 1 })).toBeInTheDocument()
    expect(main).toHaveFocus()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    window.scrollTo.mockClear()
    await user.click(screen.getByRole('button', { name: 'Test history forward' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/paychecks')
    expect(main).toHaveFocus()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    window.scrollTo.mockClear()
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(within(screen.getByRole('group', { name: 'Account options' })).getByRole('link', { name: 'Settings' }))
    expect(screen.queryByRole('group', { name: 'Account options' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/settings')
    expect(main).toHaveFocus()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    window.scrollTo.mockClear()
  })

  it('does not steal focus during in-page edits or theme changes', async () => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'synthetic-session')
    renderAt('/transactions')
    window.scrollTo.mockClear()
    const draft = screen.getByRole('textbox', { name: 'Transaction draft' })
    await user.type(draft, 'Preserved draft')
    expect(draft).toHaveFocus()
    window.scrollTo.mockClear()
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    const theme = within(screen.getByRole('group', { name: 'Account options' })).getByRole('combobox', { name: 'Theme' })
    await user.selectOptions(theme, 'dark')
    expect(theme).toHaveFocus()
    expect(draft).toHaveValue('Preserved draft')
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('clears the existing auth keys and returns to authentication on logout', async () => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'jwt-value')
    localStorage.setItem('email', 'person@example.com')
    renderAt('/overview')

    expect(screen.getByText('person@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Account person@example.com' }))
    await user.click(screen.getByRole('button', { name: 'Logout' }))

    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
  })

  it.each(['/overview', '/transactions', '/plan', '/more', '/budgets', '/analytics', '/commitments', '/paychecks', '/investing', '/settings'])(
    'recovers from a stale stored session on %s when the first protected request returns 401', async (path) => {
      localStorage.setItem('token', 'synthetic-malformed-session')
      localStorage.setItem('email', 'stale@example.invalid')
      localStorage.setItem('budget-planner-theme', 'dark')
      localStorage.setItem('ordo-language', 'es')
      const adapter = vi.fn(rejectSession)
      renderAt(path)
      expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument()

      await act(async () => {
        await expect(client.get('/api/paychecks', { adapter })).rejects.toMatchObject({ response: { status: 401 } })
      })

      expect(adapter).toHaveBeenCalledOnce()
      expect(await screen.findByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
      expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument()
      expect(screen.queryByText('stale@example.invalid')).not.toBeInTheDocument()
      expect(localStorage.getItem('token')).toBeNull()
      expect(localStorage.getItem('email')).toBeNull()
      expect(localStorage.getItem('budget-planner-theme')).toBe('dark')
      expect(localStorage.getItem('ordo-language')).toBe('es')
    },
  )

  it('leaves protected navigation on a write 401 without retrying the mutation', async () => {
    localStorage.setItem('token', 'synthetic-session')
    localStorage.setItem('email', 'person@example.invalid')
    const adapter = vi.fn(rejectSession)
    renderAt('/overview')
    await userEvent.setup().click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', { name: /Paychecks/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/paychecks')

    await act(async () => {
      await expect(client.post('/api/paychecks', { displayName: 'Synthetic expectation' }, { adapter })).rejects.toMatchObject({ response: { status: 401 } })
    })

    expect(adapter).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
  })

  it('keeps the protected shell and identity after a successful authenticated response', async () => {
    localStorage.setItem('token', 'synthetic-session')
    localStorage.setItem('email', 'person@example.invalid')
    renderAt('/paychecks')
    await act(async () => {
      await client.get('/api/paychecks', { adapter: async (config) => ({ data: [], status: 200, headers: {}, config }) })
    })
    expect(screen.getByRole('heading', { name: 'Paychecks workspace' })).toBeInTheDocument()
    expect(screen.getByText('person@example.invalid')).toBeInTheDocument()
    expect(localStorage.getItem('token')).toBe('synthetic-session')
  })

  it('keeps public recovery routing and stored identity when a public auth request returns 401', async () => {
    localStorage.setItem('token', 'synthetic-session')
    localStorage.setItem('email', 'person@example.invalid')
    client.defaults.adapter = vi.fn(rejectSession)
    renderAt('/forgot-password')
    await act(async () => {
      await expect(authApi.forgotPassword({ email: 'person@example.invalid' })).rejects.toMatchObject({ response: { status: 401 } })
    })
    expect(screen.getByRole('heading', { name: 'Forgot password content' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/forgot-password')
    expect(localStorage.getItem('token')).toBe('synthetic-session')
    expect(localStorage.getItem('email')).toBe('person@example.invalid')
  })

  it('observes invalidation before subscription and through StrictMode remounts', async () => {
    localStorage.setItem('token', 'synthetic-session')
    localStorage.setItem('email', 'person@example.invalid')
    await expect(client.get('/api/paychecks', { adapter: rejectSession })).rejects.toMatchObject({ response: { status: 401 } })
    const first = renderAt('/paychecks', { strict: true })
    expect(await screen.findByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
    first.unmount()

    localStorage.setItem('token', 'another-synthetic-session')
    renderAt('/paychecks', { strict: true })
    await act(async () => {
      await expect(client.get('/api/paychecks', { adapter: rejectSession })).rejects.toMatchObject({ response: { status: 401 } })
    })
    expect(await screen.findByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
  })

  it('synchronizes another tab clearing the session without waiting for an API request', async () => {
    localStorage.setItem('token', 'synthetic-session')
    localStorage.setItem('email', 'person@example.invalid')
    renderAt('/paychecks')
    act(() => {
      localStorage.removeItem('token')
      localStorage.removeItem('email')
      window.dispatchEvent(new StorageEvent('storage', { key: 'token', storageArea: localStorage }))
    })
    expect(await screen.findByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
    expect(screen.queryByText('person@example.invalid')).not.toBeInTheDocument()
  })

  it('discards protected page data and drafts when another tab replaces the session', async () => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'first-session')
    localStorage.setItem('email', 'first@example.invalid')
    renderAt('/transactions')
    expect(screen.getByText('Loaded transactions for first@example.invalid')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Transaction draft' }), 'First account draft')

    act(() => {
      // A suspended tab can observe the replacement before queued logout events.
      localStorage.setItem('token', 'second-session')
      localStorage.setItem('email', 'second@example.invalid')
      window.dispatchEvent(new StorageEvent('storage', { key: 'token', storageArea: localStorage }))
    })

    expect(screen.getByText('second@example.invalid')).toBeInTheDocument()
    expect(screen.queryByText('Loaded transactions for first@example.invalid')).not.toBeInTheDocument()
    expect(screen.getByText('Loaded transactions for second@example.invalid')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Transaction draft' })).toHaveValue('')
    expect(screen.getByTestId('location')).toHaveTextContent('/transactions')
  })

  it('exposes account identity and logout through the mobile account menu', async () => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'jwt-value')
    localStorage.setItem('email', 'person@example.com')
    renderAt('/overview')

    const accountMenu = screen.getByRole('button', { name: 'Account menu' })
    expect(accountMenu).toHaveAttribute('aria-expanded', 'false')
    expect(accountMenu).toHaveAttribute('aria-controls', 'mobile-account-options')
    await user.click(accountMenu)

    expect(accountMenu).toHaveAttribute('aria-expanded', 'true')
    const accountOptions = screen.getByRole('group', { name: 'Account options' })
    expect(accountOptions).toHaveTextContent('person@example.com')
    await user.click(within(accountOptions).getByRole('button', { name: 'Logout' }))

    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
  })

  it('dismisses the mobile account menu with Escape and restores trigger focus', async () => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'jwt-value')
    renderAt('/overview')

    const accountMenu = screen.getByRole('button', { name: 'Account menu' })
    await user.click(accountMenu)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('group', { name: 'Account options' })).not.toBeInTheDocument()
    expect(accountMenu).toHaveFocus()
  })

  it.each([
    ['/confirm-email?userId=user-123&token=value', 'Confirmation content'],
    ['/forgot-password', 'Forgot password content'],
    ['/reset-password?email=person%40example.com&token=value', 'Reset password content'],
  ])('keeps public recovery route %s outside the shell', (path, heading) => {
    renderAt(path)
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument()
  })

  it('keeps shell and Settings theme controls unique and synchronized', async () => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'jwt-value')
    renderAt('/settings')

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    const shellControl = within(screen.getByRole('group', { name: 'Account options' })).getByRole('combobox', { name: 'Theme' })
    const settingsControl = screen.getByRole('combobox', { name: 'Theme preference' })
    expect(shellControl.id).not.toBe(settingsControl.id)

    await user.selectOptions(settingsControl, 'dark')
    // Interacting outside the popover closes it; reopen to read the shell control.
    expect(screen.queryByRole('group', { name: 'Account options' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(within(screen.getByRole('group', { name: 'Account options' })).getByRole('combobox', { name: 'Theme' })).toHaveValue('dark')
    expect(settingsControl).toHaveValue('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem('budget-planner-theme')).toBe('dark')
  })

  it('switches adopted shell and Settings copy to Spanish without changing routes or account content', async () => {
    const user = userEvent.setup()
    localStorage.setItem('token', 'jwt-value')
    localStorage.setItem('email', 'person@example.com')
    renderAt('/settings')

    const language = screen.getByRole('combobox', { name: 'Language preference' })
    await user.selectOptions(language, 'es')

    expect(language).toHaveFocus()
    expect(document.documentElement).toHaveAttribute('lang', 'es')
    expect(localStorage.getItem('ordo-language')).toBe('es')
    expect(screen.getByRole('heading', { name: 'Configuración', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Saltar al contenido principal' })).toHaveAttribute('href', '#main-content')
    expect(screen.getByRole('button', { name: 'Menú de la cuenta' })).toBeInTheDocument()
    expect(screen.getAllByText('person@example.com')).toHaveLength(2)
    for (const name of ['Inicio', 'Actividad', 'Plan', 'Análisis']) {
      expect(within(screen.getByRole('navigation', { name: 'Navegación principal' })).getByRole('link', { name })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: 'Menú de la cuenta' }))
    const panel = screen.getByRole('group', { name: 'Opciones de la cuenta' })
    expect(within(panel).getAllByRole('link', { name: /Configuración/ })).toHaveLength(1)
    expect(within(panel).getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/settings')
  })

  it('lists account destinations and controls in the Account menu without fetching', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    localStorage.setItem('token', 'jwt-value')
    localStorage.setItem('email', 'person@example.com')
    renderAt('/overview')
    expect(within(screen.getByRole('banner')).queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    const panel = screen.getByRole('group', { name: 'Account options' })
    expect(panel).toHaveTextContent('person@example.com')
    expect(within(panel).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(within(panel).getByRole('link', { name: /Investing/ })).toHaveTextContent('Unavailable')
    expect(within(panel).getByRole('combobox', { name: 'Theme' })).toBeInTheDocument()
    expect(within(panel).getByRole('combobox', { name: 'Language' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Logout' })).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps /more routed but unlinked from the shell', () => {
    localStorage.setItem('token', 'jwt-value')
    renderAt('/more')
    expect(screen.getByRole('heading', { name: 'More', level: 1 })).toBeInTheDocument()
    expect(document.querySelector('.app-sidebar a[href="/more"], .app-pagebar a[href="/more"]')).toBeNull()
  })

  it('renders the honest Investing surface without starting an integration request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    localStorage.setItem('token', 'jwt-value')
    renderAt('/investing')
    expect(screen.getByRole('heading', { name: 'No investment source connected' })).toBeInTheDocument()
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled())
  })

  it('renders the dedicated Budgets surface without redirecting to Transactions', async () => {
    localStorage.setItem('token', 'jwt-value')
    renderAt('/budgets')

    expect(await screen.findByRole('heading', { name: 'Budgets workspace' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/budgets')
  })

  it('renders the dedicated Analytics surface without redirecting to Transactions', async () => {
    localStorage.setItem('token', 'jwt-value')
    renderAt('/analytics')

    expect(await screen.findByRole('heading', { name: 'Analytics workspace' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/analytics')
  })
})
