// Тестовая «оплата» — только для демо и автотестов: платёж сразу успешный, без банка.
// В рабочем режиме (NODE_ENV=production) не включается.
export function createTestPayments() {
  return {
    name: 'test',
    instant: true,
    async createPayment() { return { type: 'instant' }; },
    async handleWebhook() { return { status: 404, body: { error: 'Тестовый провайдер не принимает уведомления' } }; },
  };
}
