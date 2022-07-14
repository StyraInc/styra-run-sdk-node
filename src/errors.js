export const NOT_ALLOWED = 'Not allowed!'

/**
 * General Styra Run Client {@link Error}.
 */
 export class StyraRunError extends Error {
    constructor(message, path = undefined, query = undefined, cause = undefined) {
      super(message)
      this.name = "StyraRunError"
      this.path = path
      this.query = query
      this.cause = cause
    }
  
    isStyraRunError() {
      return true
    }
  }
  
  /**
   * Error for when the {@link Client#assert} {@link AssertPredicate `predicate`} rejects a policy decision.
   */
  export class StyraRunAssertionError extends StyraRunError {
    constructor(path = undefined, query = undefined) {
      super(NOT_ALLOWED, path, query)
      this.name = "StyraRunAssertionError"
    }
  }
  
  /**
   * Styra Run Client HTTP {@link Error}.
   */
  export class StyraRunHttpError extends Error {
    constructor(message, statusCode, body) {
      super(message)
      this.name = "StyraRunHttpError"
      this.statusCode = statusCode
      this.body = body
    }
  }