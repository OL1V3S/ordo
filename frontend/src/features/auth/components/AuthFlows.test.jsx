import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthPage from './AuthPage'
import ConfirmEmailPage from './ConfirmEmailPage'
import ResetPasswordPage from './ResetPasswordPage'
import ForgotPasswordPage from './ForgotPasswordPage'
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
  beforeEach(() => localStorage.clear())

  it('stores the login token and email using the existing keys', async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    authApi.login.mockResolvedValue({ data: { token: 'jwt-value', email: 'person@example.com' } })
    renderAt(<AuthPage onLogin={onLogin} />)

    expect(screen.getByRole('heading', { name: 'ordo', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBe(screen.getByPlaceholderText('Email'))
    expect(screen.getByLabelText('Password')).toBe(screen.getByPlaceholderText('Password'))
    await user.type(screen.getByPlaceholderText('Email'), 'person@example.com')
    await user.type(screen.getByPlaceholderText('Password'), 'Secret1!')
    await user.click(screen.getByRole('button', { name: 'Log In' }))

    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce())
    expect(localStorage.getItem('token')).toBe('jwt-value')
    expect(localStorage.getItem('email')).toBe('person@example.com')
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
    expect(screen.getByLabelText('Confirm password')).toBe(screen.getByPlaceholderText('Confirm Password'))
    await user.type(screen.getByPlaceholderText('Email'), 'person@example.com')
    await user.type(screen.getByPlaceholderText('Password'), 'Secret1!')
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'Secret1!')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(await screen.findByText("Your account was created, but we couldn't send the confirmation email.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }))
    expect(await screen.findByText('Too many requests. Please wait before trying again.')).toBeInTheDocument()
  })

  it('forwards confirmation query parameters unchanged', async () => {
    authApi.confirmEmail.mockResolvedValue({ data: { message: 'ok' } })
    renderAt(<ConfirmEmailPage />, '/confirm-email?userId=user-123&token=a%2Bb_c')

    expect(screen.getByRole('heading', { name: 'ordo', level: 1 })).toBeInTheDocument()
    await waitFor(() => expect(authApi.confirmEmail).toHaveBeenCalledWith({
      userId: 'user-123',
      token: 'a+b_c',
    }))
    expect(await screen.findByText('Email Confirmed')).toBeInTheDocument()
  })

  it('does not call confirmation without both required query parameters', async () => {
    renderAt(<ConfirmEmailPage />, '/confirm-email?userId=user-123')
    expect(await screen.findByText('Unable to Confirm Email')).toBeInTheDocument()
    expect(authApi.confirmEmail).not.toHaveBeenCalled()
  })

  it('forwards reset email, token, and new password from the deep link', async () => {
    const user = userEvent.setup()
    authApi.resetPassword.mockResolvedValue({ data: { message: 'ok' } })
    renderAt(<ResetPasswordPage />, '/reset-password?email=person%40example.com&token=reset%2Btoken')

    expect(screen.getByRole('heading', { name: 'ordo', level: 1 })).toBeInTheDocument()
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

    expect(screen.getByRole('heading', { name: 'ordo', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBe(screen.getByPlaceholderText('Email'))
    await user.type(screen.getByPlaceholderText('Email'), 'unknown@example.com')
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))

    expect(await screen.findByText('If the email exists, a reset link was sent.')).toBeInTheDocument()
  })
})
