const JString = Java.type('java.lang.String')
const InetSocketAddress = Java.type('java.net.InetSocketAddress')
const ByteBuffer = Java.type('java.nio.ByteBuffer')
const SelectionKey = Java.type('java.nio.channels.SelectionKey')
const Selector = Java.type('java.nio.channels.Selector')
const ServerSocketChannel = Java.type('java.nio.channels.ServerSocketChannel')
const StandardCharsets = Java.type('java.nio.charset.StandardCharsets')

let mountRequest = require('./request.js')

/**
 * Gerenciador de rotas. Processa as requisições HTTP e segundo definições
 * do bitcode (módulo) utilizado para o gerenciamento, endereça o código a
 * ser executado. Similar ao framework "Express" no ecosistema NodeJS.
 */
let router

/**
  * Função que inicia um servidor na porta informada e com o roteamento informados.
    Caso o router não seja passado, o server criará um default internamente.
  * @param {Number} port - porta em que o servidor será levantado
  * @param {thrust-bitcodes/router} [httpRouter=undefined] -router customizado com rotas de serviço
  */
function createServer(port, httpRouter, options) {
    let opts = options || {}
    let config = getConfig().http || {}
    let staticFilesPath = opts.staticFilesPath || config.staticFilesPath || '/static'

    staticFilesPath = '/' + staticFilesPath.replace(/^\/|\/\*$|\//g, '') + '/*'
    router = (httpRouter) || {
        process: function() {
            print('ERRO: HTTP Router não foi configurado/definido!!')
        }
    }

    let selector = Selector.open()
    let serverSocket = ServerSocketChannel.open()
    let httpFastConfig = getConfig()['http-fast'] || {}
    let httpFastIP = opts.address || httpFastConfig.address || '127.0.0.1'
    let serverAddress = new InetSocketAddress(httpFastIP, port)

    serverSocket.bind(serverAddress)
    serverSocket.configureBlocking(false)

    let ops = serverSocket.validOps()
    let selectKy = serverSocket.register(selector, ops, null)
    let buffer = ByteBuffer.allocate(opts.readBufferSize || httpFastConfig.readBufferSize || 32 * 1024)
    print('Running on port ' + port + '...')

    try {
        while (true) {
            selector.select()
            let iterator = selector.selectedKeys().iterator()

            while (iterator.hasNext()) {
                // java.nio.channels.SelectionKey
                let myKey = iterator.next()

                if (myKey.isAcceptable()) {
                    let client = serverSocket.accept()

                    client.configureBlocking(false)
                    client.register(selector, SelectionKey.OP_READ)
                    // print("Connection Accepted: " + client.getLocalAddress() + "\n");
                } else if (myKey.isReadable()) {
                    // java.nio.channels.SelectableChannel
                    // java.nio.channels.SocketChannel
                    let channel = myKey.channel()

                    try {
                        // service(channel, textRequest)
                        // let di = new Date().getTime()
                        service(channel, buffer)
                        // let df = new Date().getTime()
                        // console.log('\n==>', (df - di), 'ms')
                    } catch (e) {
                        if (!e.closeChannel) {
                            console.log('[ERROR] -', e.stack || e.message || e)
                            let content = e.toString()
                            let response = new JString('HTTP/1.1 500 Internal Server Error\r\n' + 'Date: ' + new Date().toString() + '\r\n' + 'Content-Type: text/plain\r\n' + 'Content-Length: ' + content.length + '\r\n' + 'Server: thrust\r\n' + 'Connection: close\r\n' + '\r\n' + content)

                            channel.write(StandardCharsets.UTF_8.encode(response))
                        }
                    } finally {
                        channel.close()
                    }
                }
                iterator.remove()
            }
        }
    } catch (ex) {
        console.log('[SERVER ERROR] -', ex)
    }
}

function service(httpChannel, buffer) {
    // let mountRequest = require('./.lib/bitcodes/thrust-bitcodes/http-fast/request.js')
    // let di = new Date().getTime()
    let request = mountRequest(httpChannel, buffer)
    // print('mountRequest processed in', (new Date().getTime() - di), 'ms')
    // di = new Date().getTime()
    let response = mountResponse(httpChannel)
    // print('mountResponse processed in', (new Date().getTime() - di), 'ms')
    // di = new Date().getTime()
    let params = parseParams(request.queryString, request.contentType)
    // print('parseParams processed in', (new Date().getTime() - di), 'ms')
    // di = new Date().getTime()
    if (request.rest === '/') {
        response.html(`<!DOCTYPE html>
                        <html>
                        <head>
                            <title>ThrustJS</title>
                            <link rel="shortcut icon" href="about:blank">
                        </head>
                        <body>ThrustJS running!!</body>
                        </html>`)
    } else if (request.rest === '/favicon.ico') {
        response.plain('')
    } else {
        router.process(params, request, response)
    }
    // print('router processed in', (new Date().getTime() - di), 'ms')
}


function mountResponse(channel) {
    const headerReturned = (headers) => {
        return Object
            .keys(headers)
            .reduce((acc, header) => {
                acc += `${header}: ${headers[header]}\r\n`
                return acc
            }, '')

    }
    let response = {
        httpResponse: channel,

        status: 200,

        contentLength: 0,

        contentType: 'text/html',

        charset: 'UTF-8',

        headers: {},

        clean: function() {
            this.headers = {}
            this.contentLength = 0
            this.contentType = 'text/html'
            this.charset = 'utf-8'
        },

        /**
         * Escreve em formato *texto* o conteúdo passado no parâmetro *content* como resposta
         * a requisição. Modifica o valor do *content-type* para *'text/html'*.
         * @param {Object} data - dado a ser enviado para o cliente.
         * @param {Number} statusCode - (opcional) status de retorno do request htttp.
         * @param {Object} headers - (opcional) configurações a serem definidas no header http.
         */
        write: function(content) {
            this.html(content)
        },

        plain: function(content) {
            let response = new JString(`HTTP/1.1 200 OK\r\nDate: ${new Date().toString()}\r\nContent-Type: text/plain\r\nContent-Length: ${content.length}\r\nServer: thrust\r\nConnection: close\r\n${headerReturned(this.headers)}\r\n${content}`)

            channel.write(StandardCharsets.UTF_8.encode(response))
        },

        json: function(data, headers) {
            let body = (typeof (data) === 'object') ? JSON.stringify(data) : data
            let response = new JString(`HTTP/1.1 200 OK\r\nDate: ${new Date().toString()}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nServer: thrust\r\nConnection: close\r\n${headerReturned(this.headers)}\r\n${body}`)

            channel.write(StandardCharsets.UTF_8.encode(response))
        },

        html: function(content) {
            let response = new JString(`HTTP/1.1 200 OK\r\nDate: ${new Date().toString()}\r\nContent-Type: text/html\r\nContent-Length: ${content.length}\r\nServer: thrust\r\nConnection: close\r\n${headerReturned(this.headers)}\r\n${content}`)

            channel.write(StandardCharsets.UTF_8.encode(response))
        },

        binary: function(content) {
            let response = new JString(`HTTP/1.1 200 OK\r\nDate: ${new Date().toString()}\r\n'Content-Type: application/octet-stream\r\nContent-Length: ${content.length}\r\nServer: thrust\r\nConnection: close\r\n${headerReturned(this.headers)}\r\n${content}`)

            channel.write(StandardCharsets.UTF_8.encode(response))
        },

        /**
         * Objeto que encapsula os métodos de retornos quando ocorre um erro na requisição http.
         * @ignore
         */
        error: {
            /**
             * Escreve em formato *JSON* uma mensagem de erro como resposta a requisição no
             * formato {message: *message*, status: *statusCode*}. Modifica o valor
             * do *content-type* para *'application/json'*.
             * @alias error.json
             * @memberof! http.Response#
             * @instance error.json
             * @param {String} message - mensagem de erro a ser enviada no retorno da chamada do browser.
             * @param {Number} statusCode - (opcional) status de retorno do request htttp.
             * @param {Object} headers - (opcional) configurações a serem definidas no header http.
             */
            json: function(message, statusCode, headers) {
                let code = statusCode || 200
                let body = JSON.stringify({
                    status: statusCode,
                    message: message
                })
                let textResponse = `HTTP/1.1 ${RESPONSE_CODES[code]}\r\nDate: ${new Date().toString()}\r\nContent-Type: application/json\r\nConnection: close\r\n${headerReturned(this.headers)}`

                for (let opt in (headers || {})) {
                    textResponse += opt + ': ' + headers[opt] + '\r\n'
                }

                textResponse += '\r\n' + body
                channel.write(StandardCharsets.UTF_8.encode(textResponse))
            }
        }
    }

    return response
}

function parseParams(strParams, contentType) {
    let params = {}

    function parseValue(value) {
        if (value === 'true') {
            return true
        }

        if (value === 'false') {
            return false
        }

        return isNaN(value) ? value : Number(value)
    }

    function parseKey(skey, value) {
        let patt = /\w+|\[\w*\]/g
        let k, ko, key = patt.exec(skey)[0]
        let p = params
        while ((ko = patt.exec(skey)) != null) {
            k = ko.toString().replace(/\[|\]/g, '')
            let m = k.match(/\d+/gi)
            if ((m != null && m.toString().length == k.length) || ko == '[]') {
                k = parseInt(k)
                p[key] = p[key] || []
            } else {
                p[key] = p[key] || {}
            }
            p = p[key]
            key = k
        }
        if (typeof (key) === 'number' && isNaN(key)) { p.push(parseValue(value)) } else { p[key] = parseValue(value) }
    }

    function parseParam(sparam) {
        // let vpar = unescape(sparam).split('=')
        // parseKey(vpar[0], vpar[1])

        var unescapedSParam = unescape(sparam)
        var firstEqualIndex = unescapedSParam.indexOf('=')
        var paramKey = unescapedSParam.substr(0, firstEqualIndex)
        var paramValue = unescapedSParam.substr(firstEqualIndex + 1)

        parseKey(paramKey, paramValue)
    }

    if (strParams != undefined && strParams !== '') {
        if (contentType && contentType.startsWith('application/json')) {
            params = JSON.parse(strParams)
        } else if (contentType.startsWith('multipart/form-data')) {
            params = strParams
        } else {
            let arrParams = strParams.split('&')

            for (let i = 0; i < arrParams.length; i++) {
                parseParam(arrParams[i])
            }
        }
    }

    return params
}

let RESPONSE_CODES = {
    100: '100 Continue',
    101: '101 Switching Protocols',
    102: '102 Processing',
    200: '200 OK',
    201: '201 Created',
    202: '202 Accepted',
    203: '203 Non-Authoritative Information',
    204: '204 No Content',
    205: '205 Reset Content',
    206: '206 Partial Content',
    207: '207 Multi-Status',
    208: '208 Already Reported',
    226: '226 IM Used',
    300: '300 Multiple Choices',
    301: '301 Moved Permanently',
    302: '302 Found',
    303: '303 See Other',
    304: '304 Not Modified',
    305: '305 Use Proxy',
    307: '307 Temporary Redirect',
    308: '308 Permanent Redirect',
    400: '400 Bad Request',
    401: '401 Unauthorized',
    402: '402 Payment Required',
    403: '403 Forbidden',
    404: '404 Not Found',
    405: '405 Method Not Allowed',
    406: '406 Not Acceptable',
    407: '407 Proxy Authentication Required',
    408: '408 Request Timeout',
    409: '409 Conflict',
    410: '410 Gone',
    411: '411 Length Required',
    412: '412 Precondition Failed',
    413: '413 Payload Too Large',
    414: '414 URI Too Long',
    415: '415 Unsupported Media Type',
    416: '416 Range Not Satisfiable',
    417: '417 Expectation Failed',
    421: '421 Misdirected Request',
    422: '422 Unprocessable Entity',
    423: '423 Locked',
    424: '424 Failed Dependency',
    426: '426 Upgrade Required',
    428: '428 Precondition Required',
    429: '429 Too Many Requests',
    431: '431 Request Header Fields Too Large',
    451: '451 Unavailable For Legal Reasons',
    500: '500 Internal Server Error',
    501: '501 Not Implemented',
    502: '502 Bad Gateway',
    503: '503 Service Unavailable',
    504: '504 Gateway Timeout',
    505: '505 HTTP Version Not Supported',
    506: '506 Variant Also Negotiates',
    507: '507 Insufficient Storage',
    508: '508 Loop Detected',
    510: '510 Not Extended',
    511: '511 Network Authentication Required'
}

exports = {
    createServer: createServer
}
