// Hermes ships Intl without PluralRules, which ICU plurals need (Uzbek and Russian are not
// `n === 1`). The `polyfill.js` entries install themselves only where the engine lacks the API.
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/uz.js';
import '@formatjs/intl-pluralrules/locale-data/ru.js';
