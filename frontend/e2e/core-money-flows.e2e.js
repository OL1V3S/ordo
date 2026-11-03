// Browser smoke tests for the core money flows (#336): web -> API -> database.
// Test data only. The account is seeded by e2e/prepare.js into a disposable
// local database. Copy is English; selectors are roles and labels, no test ids.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const API_URL = 'http://localhost:5298'

// English copy the tests depend on (src/shared/localization/locales/en).
const labels = {
  email: 'Email',
  password: 'Password',
  signIn: 'Sign in',
  description: 'Description',
  amount: 'Amount',
  date: 'Date',
  category: 'Category',
  food: 'Food',
  addExpense: 'Add expense',
  saveExpense: 'Save expense',
  expenseSaved: 'Expense saved.',
  addDeposit: 'Add deposit',
  depositSaved: 'Deposit saved. Reports use its deposit date.',
  addBudget: 'Add category budget',
  monthlyLimit: 'Monthly limit',
  saveLimit: 'Save limit',
  budgetSaved: 'Budget limit saved.',
  linkDeposit: (name) => `Link a deposit to ${name}`,
  receiptRegion: (name) => `Deposit to link to ${name}`,
  receiptRecorded: 'Deposit linked to this pay schedule.',
}

function loadAccount() {
  try {
    return JSON.parse(readFileSync(new URL('./.state/account.json', import.meta.url), 'utf8'))
  } catch {
    throw new Error('Missing e2e/.state/account.json. Run `npm run test:e2e` (it seeds the account first).')
  }
}

const account = loadAccount()
// A retry gets its own data, so a half-finished first attempt cannot cause duplicates.
const unique = (name, testInfo) => `E2E ${name} ${account.runId}${testInfo.retry ? ` retry ${testInfo.retry}` : ''}`

// Signs in through the real form and returns the access token of that session.
async function signIn(page) {
  await page.goto('/')
  await page.getByLabel(labels.email, { exact: true }).fill(account.email)
  await page.getByLabel(labels.password, { exact: true }).fill(account.password)
  const signInResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/web-session') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: labels.signIn, exact: true }).click()
  expect((await signInResponse).status()).toBe(200)
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByLabel(labels.email, { exact: true })).toHaveCount(0)
  const token = await page.evaluate(() => localStorage.getItem('token'))
  expect(token).toBeTruthy()
  return token
}

async function apiGet(request, token, path) {
  const response = await request.get(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(response.status(), `GET ${path}`).toBe(200)
  return response.json()
}

test('signs in and reaches Home', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('adds an expense', async ({ page, request }, testInfo) => {
  const token = await signIn(page)
  const description = unique('expense', testInfo)

  await page.goto('/transactions')
  await page.getByRole('button', { name: labels.addExpense, exact: true }).click()
  await page.getByLabel(labels.description, { exact: true }).fill(description)
  await page.getByLabel(labels.amount, { exact: true }).fill('12.34')
  await page.getByLabel(labels.date, { exact: true }).fill(new Date().toISOString().slice(0, 10)) // browser runs in UTC
  await page.getByRole('combobox', { name: labels.category, exact: true }).selectOption({ label: labels.food })
  await page.getByRole('button', { name: labels.saveExpense }).click()

  await expect(page.getByText(labels.expenseSaved)).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: description })).toContainText('$12.34')

  const expenses = await apiGet(request, token, '/api/expenses')
  // The API stores expense descriptions lower-cased.
  const saved = expenses.filter((expense) => expense.description.toLowerCase() === description.toLowerCase())
  expect(saved).toHaveLength(1)
  expect(Number(saved[0].amount)).toBe(12.34)
})

test('adds a cash-in deposit', async ({ page, request }, testInfo) => {
  const token = await signIn(page)
  const description = unique('deposit', testInfo)

  await page.goto('/transactions')
  await page.getByRole('button', { name: labels.addDeposit, exact: true }).click()
  const form = page.getByRole('form', { name: labels.addDeposit })
  await form.getByLabel(labels.description, { exact: true }).fill(description)
  await form.getByLabel(labels.amount, { exact: true }).fill('250.00')
  await form.getByRole('button', { name: labels.addDeposit, exact: true }).click()

  await expect(page.getByText(labels.depositSaved)).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: description })).toContainText('$250.00')

  const inflows = await apiGet(request, token, '/api/inflows')
  const saved = inflows.filter((inflow) => inflow.description === description)
  expect(saved).toHaveLength(1)
  expect(Number(saved[0].amount)).toBe(250)
})

test('sets a budget limit', async ({ page, request }) => {
  const token = await signIn(page)

  // The page picks the month; read it from its own request so the check cannot
  // disagree with the page at a month boundary.
  const limitsRequest = page.waitForRequest((req) => req.url().includes('/api/budgetlimits?monthYear='))
  await page.goto('/budgets')
  const monthYear = new URL((await limitsRequest).url()).searchParams.get('monthYear')

  await page.getByRole('button', { name: labels.addBudget, exact: true }).click()
  await page.getByRole('combobox', { name: labels.category, exact: true }).selectOption({ label: labels.food })
  await page.getByLabel(labels.monthlyLimit, { exact: true }).fill('200.00')
  await page.getByRole('button', { name: labels.saveLimit, exact: true }).click()

  await expect(page.getByText(labels.budgetSaved)).toBeVisible()

  const limits = await apiGet(request, token, `/api/budgetlimits?monthYear=${monthYear}`)
  const saved = limits.filter((limit) => limit.category.toLowerCase() === 'food')
  expect(saved).toHaveLength(1)
  expect(Number(saved[0].limitAmount)).toBe(200)
})

test('records a paycheck receipt', async ({ page, request }, testInfo) => {
  const token = await signIn(page)
  const name = unique('paycheck', testInfo)
  const depositDescription = unique('paycheck deposit', testInfo)
  // Paycheck slots are UTC. A weekly anchor of UTC today always offers the current
  // and previous slot, so a free slot exists even close to midnight.
  const anchor = new Date().toISOString().slice(0, 10)

  const created = await request.post(`${API_URL}/api/paychecks`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      displayName: name,
      schedule: { cadence: 'weekly', referenceAnchorDate: anchor },
      windowBeforeDays: 3,
      windowAfterDays: 3,
      amount: { mode: 'fixed', fixedAmount: 1000 },
    },
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()

  await page.goto('/paychecks')
  await page.getByRole('button', { name: labels.linkDeposit(name), exact: true }).click()
  const receipt = page.getByRole('region', { name: labels.receiptRegion(name) })
  await receipt.getByLabel(labels.description, { exact: true }).fill(depositDescription)
  await receipt.getByLabel(labels.amount, { exact: true }).fill('1000.00')
  await receipt.getByRole('button', { name: labels.addDeposit, exact: true }).click()

  await expect(page.getByText(labels.receiptRecorded)).toBeVisible()

  const paycheck = await apiGet(request, token, `/api/paychecks/${id}`)
  expect(paycheck.evidence).toHaveLength(1)
  expect(paycheck.evidence[0].description).toBe(depositDescription)
  expect(Number(paycheck.evidence[0].amount)).toBe(1000)

  const inflows = await apiGet(request, token, '/api/inflows')
  const linked = inflows.filter((inflow) => inflow.description === depositDescription)
  expect(linked).toHaveLength(1)
  expect(paycheck.evidence[0].accountInflowId).toBe(linked[0].id)
})
