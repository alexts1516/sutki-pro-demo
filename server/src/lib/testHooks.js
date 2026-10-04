// Точки для тестов «падение процесса»: в рабочем коде пусто и ничего не делает.
// Тест ставит testHooks.<имя> = () => { throw … } и проверяет, что после «перезапуска» всё достраивается.
export const testHooks = {};
export async function hook(name, ctx) { const f = testHooks[name]; if (f) await f(ctx); }
