import express from 'express';
import session from 'express-session';
import { engine } from 'express-handlebars';
import configRoutes from './routes/index.js';
import methodOverride from 'method-override'

const app = express();

// view engine setup
app.engine('handlebars', engine({
  defaultLayout: 'main',
  layoutsDir: './views/layouts',
  partialsDir: './views/partials',
  helpers: {
    eq: (a, b) => a === b,
    priceLabel: (value) => {
      if (typeof value === 'string') return value;
      if (Number.isInteger(value) && value > 0) return '$'.repeat(value);
      return '';
    }
  }
}));
app.set('view engine', 'handlebars');
app.set('views', './views');

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(methodOverride('_method'))

// session
// Secret comes from SESSION_SECRET when set (production); the fallback keeps
// local dev working out of the box. Cookie is httpOnly + sameSite 'lax' so it
// isn't readable from JS and isn't sent on cross-site requests.
app.use(session({
  name: 'DayOutNYC',
  secret: process.env.SESSION_SECRET || 'dayout-dev-secret-change-me',
  saveUninitialized: false,
  resave: false,
  cookie: {
    maxAge: 60000 * 60 * 24,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// makes session user available in every handlebars template
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

configRoutes(app);

app.listen(3000, () => {
  console.log("We've now got a server!");
  console.log('Your routes will be running on http://localhost:3000');
});