import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Page-load behavior of the memory-only access token (#337): with a stored
// sign-in the app shows a loading view, never sign-in, until the refresh settles.
vi.mock('../shared/api/webSessionClient', () => ({
  webSessionClient: { signIn: vi.fn(), refresh: vi.fn(), signOut: vi.fn() },
}))
vi.mock('../features/transactions/pages/TransactionsPage', () => ({ default: () => <h1>Transactions workspace</h1> }))
vi.mock('../features/budgetLimits/pages/BudgetsPage', () => ({ default: () => <h1>Budgets workspace</h1> }))
vi.mock('../features/analytics/pages/AnalyticsPage', () => ({ default: () => <h1>Analytics workspace</h1> }))
vi.mock('../features/commitments/pages/CommitmentsPage', () => ({ default: () => <h1>Commitments workspace</h1> }))
vi.mock('../features/paychecks/pages/PaychecksPage', () => ({ default: () => <h1>Paychecks workspace</h1> }))
vi.mock('./pages/OverviewPage', () => ({ default: () => <h1>Welcome back</h1> }))
vi.mock('../features/auth/components/AuthPage', () => ({ default: () => <h1>Authentication content</h1> }))

const HOUR = 60 * 60 * 1000

function jwt(msFromNow) {
  const payload = btoa(JSON.stringify({ exp: Math.floor((Date.now() + msFromNow) / 1000) }))
  return `header.${payload}.signature`
}

function deferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

function httpError(status) {
  const error = new Error(`Request failed with status code ${status}`)
  error.response = { status, data: '' }
  return error
}

const storageListeners = []
let app

async function load({ language = 'en' } = {}) {
  vi.resetModules()
  const [react, router, App, i18nModule, locale, theme, webSession, session, webClient] = await Promise.all([
    import('@testing-library/react'),
    import('react-router-dom'),
    import('./App'),
    import('../shared/localization/i18n'),
    import('../shared/localization/LocaleProvider'),
    import('../shared/theme/ThemeProvider'),
    import('../shared/auth/webSession'),
    import('../shared/auth/session'),
    import('../shared/api/webSessionClient'),
  ])
  await i18nModule.default.changeLanguage(language)
  vi.mocked(webClient.webSessionClient.refresh).mockReset()
  app = { ...react, ...router, App: App.default, LocaleProvider: locale.LocaleProvider, ThemeProvider: theme.ThemeProvider, webSession, session, client: webClient.webSessionClient }
}

function renderApp(path = '/') {
  const { render, MemoryRouter, App, LocaleProvider, ThemeProvider } = app
  return render(<MemoryRouter initialEntries={[path]}><ThemeProvider><LocaleProvider><App /></LocaleProvider></ThemeProvider></MemoryRouter>)
}

async function advance(ms) {
  await app.act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('app page-load behavior', () => {
  beforeEach(async () => {
    const addEventListener = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'storage') storageListeners.push(listener)
      return addEventListener(type, listener, options)
    })
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal('scrollTo', vi.fn())
    vi.useFakeTimers()
    await load()
  })

  afterEach(() => {
    app.cleanup()
    storageListeners.splice(0).forEach((listener) => window.removeEventListener('storage', listener))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows a loading view, then a slow note, never sign-in, while a stored sign-in waits; a late answer signs in', async () => {
    localStorage.setItem('sessionId', 'stored-sign-in')
    localStorage.setItem('email', 'person@example.invalid')
    const pending = deferred()
    app.client.refresh.mockReturnValue(pending.promise)
    void app.webSession.startWebSession()
    renderApp('/overview')

    expect(app.screen.getByRole('status')).toHaveTextContent('Loading your account...')
    expect(app.screen.queryByText('This is taking longer than usual.')).not.toBeInTheDocument()

    await advance(4100)
    expect(app.screen.getByText('This is taking longer than usual.')).toBeInTheDocument()
    await advance(10 * 60 * 1000)
    expect(app.screen.queryByRole('heading', { name: 'Authentication content' })).not.toBeInTheDocument()
    expect(app.screen.getByRole('status')).toHaveTextContent('Loading your account...')

    pending.resolve({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })
    await advance(0)

    expect(app.screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(app.screen.queryByRole('status')).not.toBeInTheDocument()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('keeps the loading view with a cannot-reach note after a server error, then signs in on the retry', async () => {
    localStorage.setItem('sessionId', 'stored-sign-in')
    localStorage.setItem('email', 'person@example.invalid')
    app.client.refresh.mockRejectedValueOnce(httpError(503))
    app.client.refresh.mockResolvedValue({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })
    void app.webSession.startWebSession()
    renderApp('/')

    await advance(1000)
    expect(app.screen.getByText("We can't reach the server right now. Trying again.")).toBeInTheDocument()
    expect(app.screen.queryByRole('heading', { name: 'Authentication content' })).not.toBeInTheDocument()

    await advance(5000)
    expect(app.client.refresh).toHaveBeenCalledTimes(2)
    expect(app.screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('shows sign-in after 4 seconds when nothing is stored', async () => {
    app.client.refresh.mockReturnValue(deferred().promise)
    void app.webSession.startWebSession()
    renderApp('/')

    expect(app.screen.getByRole('status')).toHaveTextContent('Loading your account...')
    await advance(4100)
    expect(app.screen.getByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
  })

  it('shows sign-in right away when the refresh finds no session', async () => {
    localStorage.setItem('sessionId', 'stored-sign-in')
    app.client.refresh.mockRejectedValue(httpError(401))
    void app.webSession.startWebSession()
    renderApp('/overview')

    await advance(0)
    expect(app.screen.getByRole('heading', { name: 'Authentication content' })).toBeInTheDocument()
    expect(localStorage.getItem('sessionId')).toBeNull()
  })

  it('shows the loading view, not sign-in, when another tab signs in, then adopts the new sign-in', async () => {
    app.client.refresh.mockRejectedValueOnce(httpError(401))
    void app.webSession.startWebSession()
    await advance(0)
    app.act(() => { app.session.establishSession(jwt(HOUR), 'old@example.invalid') })
    renderApp('/overview')
    expect(app.screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()

    const pending = deferred()
    app.client.refresh.mockReturnValue(pending.promise)
    app.act(() => {
      localStorage.setItem('sessionId', 'other-tab-sign-in')
      localStorage.setItem('email', 'new@example.invalid')
      window.dispatchEvent(new StorageEvent('storage', { key: 'sessionId', storageArea: localStorage }))
    })
    await advance(0)
    expect(app.screen.getByRole('status')).toHaveTextContent('Loading your account...')
    expect(app.screen.queryByRole('heading', { name: 'Authentication content' })).not.toBeInTheDocument()

    pending.resolve({ status: 200, data: { token: jwt(2 * HOUR), email: 'new@example.invalid' } })
    await advance(0)
    expect(app.screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(app.session.getSessionSnapshot()).toMatchObject({ signedIn: true, id: 'other-tab-sign-in', email: 'new@example.invalid' })
  })

  it('shows the loading text in Spanish', async () => {
    await load({ language: 'es' })
    localStorage.setItem('sessionId', 'stored-sign-in')
    app.client.refresh.mockRejectedValue(new TypeError('Failed to fetch'))
    void app.webSession.startWebSession()
    renderApp('/')

    await advance(4100)
    expect(app.screen.getByRole('status')).toHaveTextContent('Cargando tu cuenta...')
    expect(app.screen.getByText('Esto está tardando más de lo habitual.')).toBeInTheDocument()
    expect(app.screen.getByText('No podemos conectar con el servidor en este momento. Lo intentaremos de nuevo.')).toBeInTheDocument()
  })
})
