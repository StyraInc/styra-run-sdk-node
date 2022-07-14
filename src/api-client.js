import Http from "http"
import Https from "https"
import { StyraRunHttpError } from "./errors.js"
import { getBody } from "./helpers.js"

const OK = 200

export class ApiClient {
    constructor(host, port, https) {
        this.host = host
        this.port = port
        this.https = https
    }

    request(options, data) {
        const opts = {
        ...options,
        host: this.host,
        port: this.port
        }

        return new Promise((resolve, reject) => {
        try {
            const client = this.https === false ? Http : Https
            const req = client.request(opts, async (response) => {
            let body = await getBody(response);
            switch (response.statusCode) {
                case OK:
                resolve(body);
                break;
                default:
                reject(new StyraRunHttpError(`Unexpected status code: ${response.statusCode}`,
                    response.statusCode, body));
            }
            }).on('error', (err) => {
            reject(new Error('Failed to send request', {
                cause: err
            }))
            })
            if (data) {
            req.write(data);
            }
            req.end()
        } catch (err) {
            reject(new Error('Failed to send request', {
            cause: err
            }))
        }
        })
    }
}

