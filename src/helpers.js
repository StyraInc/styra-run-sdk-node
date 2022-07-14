export function getBody(stream) {
    return new Promise((resolve, reject) => {
        if (stream.body) {
        // express compatibility
        resolve(stream.body)
        } else {
        var body = ''
        stream.on('data', (data) => {
            body += data
        })
        stream.on('end', () => {
            resolve(body)
        })
        }
    })
}

export function toJson(data) {
    const json = JSON.stringify(data);
    if (json) {
        return json
    } else {
        throw new Error('JSON serialization produced undefined result')
    }
}
  
export function fromJson(val) {
    if (typeof val === 'object') {
        return val
    }
    try {
        return JSON.parse(val)
    } catch (err) {
        throw new Error('Invalid JSON', {cause: err})
    }
}