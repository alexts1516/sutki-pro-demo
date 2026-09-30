// Роли в аккаунте. Владелец видит всё, включая финансы; админ — всё, кроме финансов и платежей;
// клининг и мастер — только свои задачи.
export const ROLES = ['owner', 'admin', 'cleaning', 'master'];
export const MANAGERS = ['owner', 'admin'];
export const STAFF = ['cleaning', 'master'];
export const ROLE_NAMES = {
  ru: { owner: 'Владелец', admin: 'Администратор', cleaning: 'Специалист по клинингу', master: 'Мастер' },
  en: { owner: 'Owner', admin: 'Administrator', cleaning: 'Cleaning specialist', master: 'Handyman' },
};
