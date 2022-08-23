export const NOT_ALLOWED = 'Not allowed!'

/**
 * General Styra Run Client {@link Error}.
 */
export class StyraRunError extends Error {
  constructor(message, cause = undefined) {
    super(cause?.message ? `${message}: ${cause.message}` : message)
    this.name = "StyraRunError"
    this.cause = cause
  }

  isStyraRunError() {
    return true // why is this necessary?  just check the class instance?  error instanceOf StyraRunError 
  }
}

/**
 * Error for when the {@link Client#assert} {@link AssertPredicate `predicate`} rejects a policy decision.
 */
export class StyraRunAssertionError extends StyraRunError {
  constructor() {
    super(NOT_ALLOWED)
    this.name = "StyraRunAssertionError"
  }

  isStyraRunAssertionError() {
    return true
  }
}

/**
 * Styra Run Client HTTP {@link Error}.
 */
export class StyraRunHttpError extends StyraRunError {
  constructor(message, statusCode, body) {
    super(message)
    this.name = "StyraRunHttpError"
    this.statusCode = statusCode
    this.body = body
  }

  isStyraRunHttpError() {
    return true
  }

  isNotFoundStatus() {
    return this.statusCode === 404
  }

  isUnauthorizedStatus() {
    return this.statusCode === 401
  }
}