// Роли в аккаунте. Владелец видит всё, включая финансы; админ — всё, кроме финансов и платежей;
// клининг и мастер — только свои задачи; водитель — только трансферы (предложения и свои заказы).
export const ROLES = ['owner', 'admin', 'cleaning', 'master', 'driver'];
export const MANAGERS = ['owner', 'admin'];
export const STAFF = ['cleaning', 'master', 'driver'];
export const ROLE_NAMES = {
  ru: { owner: 'Владелец', admin: 'Администратор', cleaning: 'Специалист по подготовке', master: 'Мастер', driver: 'Водитель' },
  en: { owner: 'Owner', admin: 'Administrator', cleaning: 'Preparation specialist', master: 'Handyman', driver: 'Driver' },
};
