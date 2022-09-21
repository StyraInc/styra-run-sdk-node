/**
 * @callback SessionInputStrategyCallback
 * @param {IncomingMessage} request the incoming HTTP request
 * @param {string} path the path to the policy rule being queried
 * @param {*} input the input document/value for the policy query
 * @returns {Promise<*>} the input document/value that should be used for the proxied policy query
 */

class CookieSessionInputStrategy {
  constructor(cookieName) {
    this.cookieName = cookieName
  }

  updateInput(request, path, input) {
    if (input && (typeof input !== 'object' || Array.isArray(input))) {
      // The given input isn't an object, so we can't inject session info into it.
      return input
    }

    const cookie = getCookie(this.cookieName, request)
    if (cookie) {
      const [tenant, subject] = cookie.split(' / ')

      if (input === undefined) {
        return {tenant, subject}
      } else {
        // tenant and subject overrides incoming properties of same name.
        return {...input, tenant, subject}
      }
    }
    return input
  }
}

function getCookie(name, request) {
  return getCookies(request)[name]
}

function getCookies(request) {
  const cookies = {}

  const header = request.headers['cookie']
  if (header) {
    header.split(';').forEach((cookie) => {
      const [name, ...value] = cookie.split(`=`)
      cookies[name.trim()] = value.join('=').trim()
    })
  }

  return cookies
}

/**
 * Creates a {@link SessionInputStrategyCallback} function that extracts `subject` and `tenant` parameters from a cookie on the incoming HTTP request.
 * The cookie value is expected to have the format `<tenant> / <subject>`.
 *
 * @param {string} cookieName the name of the cookie on the incoming HTTP request
 * @returns {function(*, *, *): *|{subject: *, tenant: *}|(*&{subject: *, tenant: *})}
 */
export function newCookieSessionInputStrategy({cookieName = 'user'} = {}) {
  const strategy = new CookieSessionInputStrategy(cookieName)
  return (request, path, input) => {
    return strategy.updateInput(request, path, input)
  }
}

/**
 * A set of default {@link SessionInputStrategyCallback} functions.
 *
 * * `COOKIE`: Extracts `subject` and `tenant` parameters from a cookie named `user` on the incoming HTTP request.
 *   The cookie value is expected to have the format `<tenant> / <subject>`.
 *   The {@link newCookieSessionInputStrategy} factory function can be used for creating a callback that pulls information from a cookie with a custom name.
 * * `NONE`: Returns the `input` value provided by the client, if any.
 *
 * @type {{COOKIE: SessionInputStrategyCallback, NONE: SessionInputStrategyCallback}}
 */
export const DefaultSessionInputStrategy = {
  COOKIE: newCookieSessionInputStrategy(),
  NONE: (_, __, input) => input
}