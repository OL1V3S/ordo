import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuthPage from './AuthPage'
import ConfirmEmailPage from './ConfirmEmailPage'
import ResetPasswordPage from './ResetPasswordPage'
import ForgotPasswordPage from './ForgotPasswordPage'
import i18n from '../../../shared/localization/i18n'
import { authApi } from '../../../shared/api/authApi'

vi.mock('../../../shared/api/authApi', () => ({
  authApi: {
    register: vi.fn(),
    login: vi.fn(),
    resendConfirmation: vi.fn(),
    confirmEmail: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
}))

function renderAt(ui, initialEntry = '/') {
  return render(<MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>)
}

describe('existing authentication flows', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })
  afterEach(() => i18n.changeLanguage('en'))

  it('stores the login token and email using the existing keys', async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    authApi.login.mockResolvedValue({ data: { token: 'jwt-value', email: 'person@example.com' } })
    renderAt(<AuthPage onLogin={onLogin} />)

    expect(screen.getByRole('heading', { name: 'Log in', level: 1 })).toHaveFocus()
    expect(screen.getByText('ordo')).not.toHaveRole('heading')
    expect(screen.getByText('Email', { selector: 'label' })).toBeVisible()
    expect(screen.getByText('Password', { selector: 'label' })).toBeVisible()
    expect(screen.getByLabelText('Email')).toBe(screen.getByPlaceholderText('Email'))
    expect(screen.getByLabelText('Password')).toBe(screen.getByPlaceholderText('Password'))
    await user.type(screen.getByPlaceholderText('Email'), 'person@example.com')
    await user.type(screen.getByPlaceholderText('Password'), 'Secret1!')
    await user.click(screen.getByRole('button', { name: 'Log In' }))

    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce())
    expect(localStorage.getItem('token')).toBe('jwt-value')
    expect(localStorage.getItem('email')).toBe('person@example.com')
  })

  it('establishes the session without requiring an App callback', async () => {
    const user = userEvent.setup()
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    authApi.login.mockResolvedValue({ data: { token: 'new-synthetic-session', email: 'person@example.invalid' } })
    renderAt(<AuthPage />)
    await user.type(screen.getByLabelText('Email'), 'person@example.invalid')
    await user.type(screen.getByLabelText('Password'), 'Synthetic1!')
    await user.click(screen.getByRole('button', { name: 'Log In' }))
    await waitFor(() => expect(localStorage.getItem('token')).toBe('new-synthetic-session'))
    expect(localStorage.getItem('email')).toBe('person@example.invalid')
    expect(alert).not.toHaveBeenCalled()
    alert.mockRestore()
  })

  it('retains the public login 401 message without establishing a session', async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    authApi.login.mockRejectedValue({ response: { status: 401, data: 'Invalid email or password' } })
    renderAt(<AuthPage onLogin={onLogin} />)
    await user.type(screen.getByLabelText('Email'), 'person@example.invalid')
    await user.type(screen.getByLabelText('Password'), 'Synthetic1!')
    await user.click(screen.getByRole('button', { name: 'Log In' }))
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Invalid email or password')
    expect(error).toHaveFocus()
    expect(alert).not.toHaveBeenCalled()
    expect(onLogin).not.toHaveBeenCalled()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
    log.mockRestore()
    alert.mockRestore()
  })

  it('shows a fixed localized message for an unmapped login 401 body', async () => {
    const user = userEvent.setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    authApi.login.mockRejectedValue({ response: { status: 401, data: 'invalid email or password ' } })
    renderAt(<AuthPage onLogin={vi.fn()} />)
    await user.type(screen.getByLabelText('Email'), 'person@example.invalid')
    await user.type(screen.getByLabelText('Password'), 'Synthetic1!')
    await user.click(screen.getByRole('button', { name: 'Log In' }))
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Unable to log in right now. Please try again.')
    expect(error).not.toHaveTextContent('invalid email or password')
    log.mockRestore()
  })

  it('keeps the neutral registration delivery failure and rate-limit presentation', async () => {
    const user = userEvent.setup()
    authApi.register.mockRejectedValue({
      response: {
        data: {
          code: 'confirmation_email_delivery_failed',
          message: "Your account was created, but we couldn't send the confirmation email.",
        },
      },
    })
    authApi.resendConfirmation.mockRejectedValue({ response: { status: 429 } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    renderAt(<AuthPage onLogin={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Need an account? Register' }))
    expect(screen.getByRole('heading', { name: 'Create account', level: 1 })).toHaveFocus()
    expect(screen.getByText('Confirm password', { selector: 'label' })).toBeVisible()
    expect(screen.getByLabelText('Confirm password')).toBe(screen.getByPlaceholderText('Confirm Password'))
    await user.type(screen.getByPlaceholderText('Email'), 'person@example.com')
    await user.type(screen.getByPlaceholderText('Password'), 'Secret1!')
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'Secret1!')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(await screen.findByRole('heading', { name: 'Check your email', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent("Your account was created, but we couldn't send the confirmation email.")
    await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Please wait before trying again.')
  })

  it('renders an email with special characters intact in the check-email view', async () => {
    const user = userEvent.setup()
    authApi.register.mockResolvedValue({ data: {} })
    renderAt(<AuthPage onLogin={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Need an account? Register' }))
    await user.type(screen.getByLabelText('Email'), "a+b&c'd@example.com")
    await user.type(screen.getByLabelText('Password'), 'Secret1!')
    await user.type(screen.getByLabelText('Confirm password'), 'Secret1!')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText("a+b&c'd@example.com", { selector: 'strong' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent("A confirmation link was sent to a+b&c'd@example.com.")
  })

  it('forwards confirmation query parameters unchanged', async () => {
    authApi.confirmEmail.mockResolvedValue({ data: { message: 'ok' } })
    renderAt(<ConfirmEmailPage />, '/confirm-email?userId=user-123&token=a%2Bb_c')

    expect(screen.getByRole('heading', { name: 'Confirming email', level: 1 })).toBeInTheDocument()
    await waitFor(() => expect(authApi.confirmEmail).toHaveBeenCalledWith({
      userId: 'user-123',
      token: 'a+b_c',
    }))
    expect(await screen.findByRole('heading', { name: 'Email confirmed', level: 1 })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('You can now log in.')
  })

  it('does not call confirmation without both required query parameters', async () => {
    renderAt(<ConfirmEmailPage />, '/confirm-email?userId=user-123')
    expect(await screen.findByRole('heading', { name: 'Unable to confirm email', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('invalid, expired, or already used')
    expect(authApi.confirmEmail).not.toHaveBeenCalled()
  })

  it('forwards reset email, token, and new password from the deep link', async () => {
    const user = userEvent.setup()
    authApi.resetPassword.mockResolvedValue({ data: { message: 'ok' } })
    renderAt(<ResetPasswordPage />, '/reset-password?email=person%40example.com&token=reset%2Btoken')

    expect(screen.getByRole('heading', { name: 'Reset password', level: 1 })).toHaveFocus()
    expect(screen.getByText('New password', { selector: 'label' })).toBeVisible()
    expect(screen.getByLabelText('New password')).toBe(screen.getByPlaceholderText('New password'))
    await user.type(screen.getByPlaceholderText('New password'), 'NewSecret1!')
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))

    await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith({
      email: 'person@example.com',
      token: 'reset+token',
      newPassword: 'NewSecret1!',
    }))
  })

  it('presents the forgot-password endpoint neutral response', async () => {
    const user = userEvent.setup()
    authApi.forgotPassword.mockResolvedValue({
      data: { message: 'If the email exists, a reset link was sent.' },
    })
    renderAt(<ForgotPasswordPage />, '/forgot-password')

    expect(screen.getByRole('heading', { name: 'Forgot password', level: 1 })).toHaveFocus()
    expect(screen.getByText('Email', { selector: 'label' })).toBeVisible()
    expect(screen.getByLabelText('Email')).toBe(screen.getByPlaceholderText('Email'))
    await user.type(screen.getByPlaceholderText('Email'), 'unknown@example.com')
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))

    expect(await screen.findByRole('status')).toHaveTextContent('If the email exists, a reset link was sent.')
  })

  it('exposes password visibility as a pressed toggle without changing the password', async () => {
    const user = userEvent.setup()
    renderAt(<AuthPage onLogin={vi.fn()} />)

    const password = screen.getByLabelText('Password')
    const reveal = screen.getByRole('button', { name: 'Show password' })
    await user.type(password, 'Secret1!')

    expect(password).toHaveAttribute('type', 'password')
    expect(reveal).toHaveAttribute('aria-pressed', 'false')
    await user.click(reveal)
    expect(password).toHaveAttribute('type', 'text')
    expect(password).toHaveValue('Secret1!')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps registration requirements visible and associated with the password field', async () => {
    const user = userEvent.setup()
    renderAt(<AuthPage onLogin={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Need an account? Register' }))

    const password = screen.getByLabelText('Password')
    expect(screen.getByText('Password must include:')).toBeVisible()
    expect(screen.getByText('At least 6 characters')).toBeVisible()
    expect(password).toHaveAccessibleDescription(/At least 6 characters/)
    expect(screen.getByRole('button', { name: 'Show confirm password' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports a password mismatch inline and does not submit registration', async () => {
    const user = userEvent.setup()
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderAt(<AuthPage onLogin={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Need an account? Register' }))
    await user.type(screen.getByLabelText('Email'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'Secret1!')
    await user.type(screen.getByLabelText('Confirm password'), 'Different1!')
    const registerButton = screen.getByRole('button', { name: 'Register' })
    await user.click(registerButton)

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Passwords do not match.')
    expect(error).toHaveFocus()

    registerButton.focus()
    expect(registerButton).toHaveFocus()
    await user.click(registerButton)
    expect(error).toHaveFocus()

    expect(authApi.register).not.toHaveBeenCalled()
    expect(alert).not.toHaveBeenCalled()
    alert.mockRestore()
  })

  it('preserves native required and email validation before login submission', async () => {
    const user = userEvent.setup()
    renderAt(<AuthPage onLogin={vi.fn()} />)

    const email = screen.getByLabelText('Email')
    const password = screen.getByLabelText('Password')
    expect(email).toBeRequired()
    expect(password).toBeRequired()

    await user.click(screen.getByRole('button', { name: 'Log In' }))
    expect(authApi.login).not.toHaveBeenCalled()

    await user.type(email, 'not-an-email')
    await user.type(password, 'Secret1!')
    expect(email).toBeInvalid()
    await user.click(screen.getByRole('button', { name: 'Log In' }))
    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('registers with the existing payload and moves to check-email without establishing a session', async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    authApi.register.mockResolvedValue({ data: {} })
    renderAt(<AuthPage onLogin={onLogin} />)

    await user.click(screen.getByRole('button', { name: 'Need an account? Register' }))
    await user.type(screen.getByLabelText('Email'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'Secret1!')
    await user.type(screen.getByLabelText('Confirm password'), 'Secret1!')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'Secret1!',
    }))
    expect(await screen.findByRole('heading', { name: 'Check your email', level: 1 })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('A confirmation link was sent to person@example.com.')
    expect(screen.getByText('person@example.com', { selector: 'strong' })).toBeVisible()
    expect(onLogin).not.toHaveBeenCalled()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
  })

  it('keeps a confirmation resend result visible after its recovery disclosure closes', async () => {
    const user = userEvent.setup()
    authApi.resendConfirmation.mockResolvedValue({
      data: { message: 'If an unconfirmed account exists for that email, a confirmation link has been sent.' },
    })
    renderAt(<ForgotPasswordPage />, '/forgot-password')

    await user.type(screen.getByLabelText('Email'), 'unknown@example.com')
    const recovery = screen.getByText('Need a new confirmation email?', { selector: 'summary' })
    await user.click(recovery)
    await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }))

    await waitFor(() => expect(authApi.resendConfirmation).toHaveBeenCalledWith({
      email: 'unknown@example.com',
    }))
    const result = await screen.findByRole('status')
    expect(result).toHaveTextContent('If an unconfirmed account exists for that email, a confirmation link has been sent.')
    await user.click(recovery)
    expect(result).toBeVisible()
  })

  it('keeps reset failure inline with the recovery action available', async () => {
    const user = userEvent.setup()
    authApi.resetPassword.mockRejectedValue(new Error('synthetic failure'))
    renderAt(<ResetPasswordPage />, '/reset-password?email=person%40example.com&token=reset%2Btoken')

    await user.type(screen.getByLabelText('New password'), 'NewSecret1!')
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Error resetting password.')
    expect(screen.getByRole('button', { name: 'Back to login' })).toBeVisible()
  })
})

describe('authentication pages in Spanish', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    return i18n.changeLanguage('es')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    return i18n.changeLanguage('en')
  })

  async function fillLogin(user, label = 'Contraseña') {
    await user.type(screen.getByLabelText('Correo electrónico'), 'person@example.com')
    await user.type(screen.getByLabelText(label), 'Secret1!')
  }

  it('renders the login and registration pages in Spanish before sign-in', async () => {
    const user = userEvent.setup()
    renderAt(<AuthPage onLogin={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Iniciar sesión', level: 1 })).toHaveFocus()
    expect(screen.getByText('ordo')).toBeVisible()
    expect(screen.getByLabelText('Contraseña')).toBe(screen.getByPlaceholderText('Contraseña'))
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toBeVisible()
    expect(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '¿Necesitas una cuenta? Regístrate' }))
    expect(screen.getByRole('heading', { name: 'Crear cuenta', level: 1 })).toHaveFocus()
    expect(screen.getByLabelText('Contraseña')).toHaveAccessibleDescription(/Al menos 6 caracteres/)
    expect(screen.getByRole('button', { name: 'Mostrar confirmación de contraseña' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Registrarse' })).toBeVisible()
  })

  it('shows the password mismatch in Spanish', async () => {
    const user = userEvent.setup()
    renderAt(<AuthPage onLogin={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '¿Necesitas una cuenta? Regístrate' }))
    await fillLogin(user)
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'Different1!')
    await user.click(screen.getByRole('button', { name: 'Registrarse' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.')
  })

  it('maps login 401 literals to Spanish and never shows the server English', async () => {
    const user = userEvent.setup()
    authApi.login.mockRejectedValueOnce({ response: { status: 401, data: 'Invalid email or password' } })
    renderAt(<AuthPage onLogin={vi.fn()} />)
    await fillLogin(user)
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Correo electrónico o contraseña no válidos')
    expect(error).not.toHaveTextContent('Invalid')

    authApi.login.mockRejectedValueOnce({ response: { status: 401, data: 'Please confirm your email before logging in.' } })
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Confirma tu correo electrónico antes de iniciar sesión.'))
  })

  it('maps Identity registration errors to Spanish and falls back for unknown codes', async () => {
    const user = userEvent.setup()
    authApi.register.mockRejectedValue({
      response: { status: 400, data: [
        { code: 'PasswordRequiresDigit', description: 'Passwords must have at least one digit' },
        { code: 'DuplicateEmail', description: "Email 'x' is already taken." },
        { code: 'SomethingNew', description: 'Some new English text' },
      ] },
    })
    renderAt(<AuthPage onLogin={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '¿Necesitas una cuenta? Regístrate' }))
    await fillLogin(user)
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'Secret1!')
    await user.click(screen.getByRole('button', { name: 'Registrarse' }))
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent("Las contraseñas deben tener al menos un dígito ('0'-'9').")
    expect(error).toHaveTextContent("El correo electrónico 'person@example.com' ya está en uso.")
    expect(error).toHaveTextContent('No se puede crear tu cuenta.')
    expect(error).not.toHaveTextContent('Some new English text')
  })

  it('falls back to the Spanish generic message for unknown failures', async () => {
    const user = userEvent.setup()
    authApi.login.mockRejectedValue(new Error('Network Error'))
    renderAt(<AuthPage onLogin={vi.fn()} />)
    await fillLogin(user)
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Algo salió mal.')
    expect(error).not.toHaveTextContent('Network Error')
  })

  it('shows check-email, delivery failure, and resend results in Spanish', async () => {
    const user = userEvent.setup()
    authApi.register.mockRejectedValue({ response: { status: 503, data: { code: 'confirmation_email_delivery_failed', message: 'English from server' } } })
    authApi.resendConfirmation.mockRejectedValue({ response: { status: 429 } })
    renderAt(<AuthPage onLogin={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '¿Necesitas una cuenta? Regístrate' }))
    await fillLogin(user)
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'Secret1!')
    await user.click(screen.getByRole('button', { name: 'Registrarse' }))
    expect(await screen.findByRole('heading', { name: 'Revisa tu correo electrónico', level: 1 })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Tu cuenta se creó, pero no pudimos enviar el correo de confirmación.')
    expect(screen.getByText('person@example.com', { selector: 'strong' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Reenviar correo de confirmación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiadas solicitudes. Espera un momento antes de volver a intentarlo.')
  })

  it('localizes confirm, forgot, and reset pages without showing server text', async () => {
    const user = userEvent.setup()
    authApi.confirmEmail.mockResolvedValue({ data: { message: 'English' } })
    const confirm = renderAt(<ConfirmEmailPage />, '/confirm-email?userId=u&token=t')
    expect(await screen.findByRole('heading', { name: 'Correo electrónico confirmado', level: 1 })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Ya puedes iniciar sesión.')
    confirm.unmount()

    authApi.forgotPassword.mockResolvedValue({ data: { message: 'If the email exists, a reset link was sent.' } })
    authApi.resendConfirmation.mockResolvedValue({ data: { message: 'English' } })
    const forgot = renderAt(<ForgotPasswordPage />, '/forgot-password')
    expect(screen.getByRole('heading', { name: '¿Olvidaste tu contraseña?', level: 1 })).toBeVisible()
    await user.type(screen.getByLabelText('Correo electrónico'), 'x@example.com')
    await user.click(screen.getByRole('button', { name: 'Enviar enlace de restablecimiento' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Si el correo electrónico existe, se envió un enlace de restablecimiento.')
    expect(screen.getByRole('region', { name: 'Ayuda para confirmar la cuenta' })).toBeVisible()
    forgot.unmount()

    authApi.resetPassword.mockRejectedValue(new Error('x'))
    renderAt(<ResetPasswordPage />, '/reset-password?email=a%40b.com&token=t')
    expect(screen.getByRole('button', { name: 'Mostrar nueva contraseña' })).toBeVisible()
    await user.type(screen.getByLabelText('Nueva contraseña'), 'NewSecret1!')
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Error al restablecer la contraseña.')
  })

  it('offers a language selector that keeps focus and re-renders an on-screen error', async () => {
    const user = userEvent.setup()
    authApi.login.mockRejectedValue({ response: { status: 401, data: 'Invalid email or password' } })
    renderAt(<AuthPage onLogin={vi.fn()} />)
    await fillLogin(user)
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    const error = await screen.findByRole('alert')
    expect(error).toHaveFocus()

    const select = screen.getByRole('combobox')
    select.focus()
    await user.selectOptions(select, 'en')
    expect(select).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Log in', level: 1 })).not.toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByRole('alert')).not.toHaveFocus()
    expect(document.documentElement.lang).toBe('en')
  })
})
