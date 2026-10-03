// cookie-parser для демо: «cookie» уже разобраны слоем перехвата запросов (demo/browser/backend.js)
export default function cookieParser() { return (req, _res, next) => { req.cookies = req.cookies || {}; next(); }; }
