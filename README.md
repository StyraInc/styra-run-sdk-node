# The Styra Run Node.js SDK

## How to Install

On the command line:

```sh
npm install --save styra-run-sdk-node
```

or in your package.json:
```json
{
    "dependencies": {
        "styra-run-sdk-node": "latest"
    }
}
```

## How to Use

### Instantiate a Run Client

```javascript
// Options are pulled from the environment
import StyraRun from "styra-run"

const options = {
  https: process.env.RUN_URL
  token: process.env.RUN_TOKEN
}
const client = StyraRun.New(options)
```

### Check

```javascript
const input = {...}
client.check('foo/bar/allowed', input)
    .then(({result}) => {
        if (result) {
            // Handle policy result
            ...
        }
        // Handle policy reject
        ...
        return Promise.reject(...)
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Assert

By default, the `assert()` function requires the policy decission to contain `{"result": true}`.

```javascript
const input = {...}
client.assert('foo/bar/allowed', input)
    .then(() => {
        // Handle accept
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

However, the default predicate can be overridden:

```javascript
const input = {...}
// Predicate that requires the policy rule to return a dictionary containing a `{"role": "admin"}` entry.
const myPredicate = (response) => {
    return response?.result?.role === 'admin'
}
client.assert('foo/bar/allowed', input, myPredicate)
    .then(() => {
        // Handle accept
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

Often, when asserting that something is allowed according to a policy, there is some piece of data that should be processed in following steps. There is a convenience function for this case:

```javascript
const input = {...}
const maybeAllowedObject = ...
client.assertAndReturn(maybeAllowedObject, 'foo/bar/allowed', input)
    .then((allowedObject) => {
        // Do something with the allowed object
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Filtering

```javascript
import sdk, { DEFAULT_PREDICATE } from "run-sdk"

const list = ["do", "re", "mi"]
const toInput = (item) => {
    return {note: item}
}

// The default predicate asserts the policy decision is equal to `{"result": true}`
client.filter(list, DEFAULT_PREDICATE, 'foo/bar/allowed', list, toInput)
    .then((filteredList) => {
        // handle filtered list
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Upload Data

```javascript
const data = ...
client.putData('bindings/foo/bar', data)
    .then(({version}) => {
        // Handle success
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Get Data

```javascript
client.getData('bindings/foo/bar')
    .then((data) => {
        // Handle data
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Delete Data

```javascript
client.deleteData('bindings/foo/bar')
    .then(({version}) => {
        // Handle success
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Proxy Client-Side Policy Checks

The Styra Run client can produce a HTTP request handler that proxies browser/client-side policy queries to Styra Run. This proxy is compatible with, and necessary for, the [Styra Run js SDK](https://github.com/StyraInc/styra-run-sdk-js).

```javascript
import {Router} from 'express'

const router = Router()

router.post('/authz', client.proxy(async (req, res, path, input) => {
    return {
            ...input,
            subject: req.subject, // Add subject from session
        }
    }))

export default {
  router
}
```

The `proxy(onProxy)` function takes a callback function as argument, and returns a request handling function. The provided callback function takes as arguments the incoming HTTP `Request`, the outgoing HTTP `Response`, the `path` of the queried policy, and the, possibly incomplete, `input` document for the query. The callback must return an updated version of the provided `input` document.

### RBAC Management API

The Styra Run client can produce a HTTP request handler providing the RBAC management API necessary for the RBAC management widget provided by the [Styra Run js SDK](https://github.com/StyraInc/styra-run-sdk-js).

```javascript
router.all('/rbac/*', styra.manageRbac(async (req) => {
    return {subject: req.auth.subject, tenant: req.auth.tenant}
}))
```

The `manageRbac(createInput)` function takes a callback function as argument, and returns a request handling function. The provided callback function takes the incoming HTTP `Request` and produces an dictionary/object that must contain two attributes:

* `subject`: a `string` representing the subject of the user session with which the request was made.
* `tenant`: a `string` representing the tenant of the user session with which the request was made.
