let JString = Java.type('java.lang.String')
let URLDecoder = Java.type('java.net.URLDecoder')
let IOException = Java.type('java.io.IOException')
let InetSocketAddress = Java.type('java.net.InetSocketAddress')
let ByteBuffer = Java.type('java.nio.ByteBuffer')
let SelectionKey = Java.type('java.nio.channels.SelectionKey')
let Selector = Java.type('java.nio.channels.Selector')
let ServerSocketChannel = Java.type('java.nio.channels.ServerSocketChannel')
let SocketChannel = Java.type('java.nio.channels.SocketChannel')
let Iterator = Java.type('java.util.Iterator')
let StandardCharsets = Java.type('java.nio.charset.StandardCharsets')

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

    let httpFastConfig = getConfig()['http-fast']
    let httpFastIP = httpFastConfig ? httpFastConfig.address : '127.0.0.1'
    let serverAddress = new InetSocketAddress(httpFastIP || '127.0.0.1', port)

    serverSocket.bind(serverAddress)
    serverSocket.configureBlocking(false)
    let ops = serverSocket.validOps()
    let selectKy = serverSocket.register(selector, ops, null)
    print('Running on port ' + port + '...')

    try {
        while (true) {
            selector.select()
            let iterator = selector.selectedKeys().iterator()

            while (iterator.hasNext()) {
                let myKey = iterator.next()

                if (myKey.isAcceptable()) {
                    let client = serverSocket.accept()

                    client.configureBlocking(false)
                    client.register(selector, SelectionKey.OP_READ)
                    // print("Connection Accepted: " + client.getLocalAddress() + "\n");
                } else if (myKey.isReadable()) {
                    let channel = myKey.channel()

                    let httpReadBufferSize = httpFastConfig.readBufferSize || (32 * 2014)
                    let buffer = ByteBuffer.allocate(httpReadBufferSize)

                    let len = channel.read(buffer)

                    if (len <= 0) {
                        continue
                    }

                    buffer.flip()
                    let textRequest = new JString(buffer.array(), 0, len, StandardCharsets.UTF_8)
                    // print("Message received: " + textRequest);

                    try {
                        service(channel, textRequest)
                    } catch (e) {
                        console.log('[ERROR] -', e.stack)
                        let content = e.toString()
                        let response = new JString('HTTP/1.1 500 Internal Server Error\r\n' + 'Date: ' + new Date().toString() + '\r\n' + 'Content-Type: text/plain\r\n' + 'Server: thrust\r\n' + 'Connection: close\r\n' + '\r\n' + content)

                        channel.write(StandardCharsets.UTF_8.encode(response))
                        channel.close()
                    }
                    
                    // channel.write(ByteBuffer.wrap(('HTTP/1.1 200 OK\r\n' + 'Date: ' + new Date().toString() + '\r\n' +
                    //   'Content-Type: text/plain\r\n' + 'Content-Length: 5\r\n' + 'Server: thrust\r\n' +
                    //   'Connection: keep-alive\r\n' + '\r\nOK!!!').getBytes()))
                }
                iterator.remove()
            }
        }
    } catch (ex) {
        console.log('[SERVER ERROR] -', ex)
    }
}

// function service(httpRequest, httpResponse) {
function service(httpChannel, textRequest) {
    // let di = new Date().getTime()
    let request = mountRequest(httpChannel, textRequest)
    // print('mountRequest processed in', (new Date().getTime() - di), 'ms')
    // di = new Date().getTime()
    let response = mountResponse(httpChannel, textRequest)
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

function mountRequest(httpChannel, textRequest) {
    let headerAndBody = textRequest.split('\r\n\r\n')
    let textHeaders = headerAndBody[0].split('\r\n')
    let textBody = headerAndBody[1]
    let headers
    let getHeaders = function() {
        if (headers) {
            return headers
        } else {
            headers = {}
        }

        for (let i = 1; i < textHeaders.length; i++) {
            let p = 0
            let hdr = textHeaders[i].split(/:\s*/g)
            let key = hdr[p++]

            if (key === 'Host') {
                headers[key] = hdr[p++]
                headers['Port'] = (hdr[p]) ? hdr[p] : '80'
            } /*else if (key === 'Cookie') {
                if (!headers['Cookie']) {
                    headers['Cookie'] = {}
                }

                // const cookieKeyAndValue = hdr[p].split('=')
                // for (let j = 0; j < cookieKeyAndValue.length; j+=2) {
                //     headers['Cookie'][cookieKeyAndValue[j]] = cookieKeyAndValue[j+1]
                // }
                //TODO: AJUSTAR REGEX PARA COOKIES
                const cookiesList = hdr[p].split(';')
                for (let j = 0; j < cookiesList.length; j++) {
                    const cookie = cookiesList[j].split('=')
                    headers['Cookie'][cookie[0].trim()] = cookie[1]
                }
            }*/ else {
                if (hdr.length > 2) {
                    //TODO: avaliar para tornar oficial
                    // headers[key] = hdr.shift().join(':')
                    headers[key] = hdr.join(':')
                } else {
                    headers[key] = hdr[p]
                }
            }
        }

        // console.log('\nheadersObj =>', headers)
        return headers
    }

    // print('textRequest =>', textRequest)
    // console.log('textHeaders =>', textHeaders)
    // console.log('textBody =>', textBody)

    let contentType = (textRequest.match(/Content-Type:\s+[\w|/]+/gi) || [''])[0].replace(/Content-Type:\s+/gi, '')
    // let contentType = headers['Content-Type'] || ''
    let methodAndUri = textHeaders[0].split(' ')
    let httpMethod = methodAndUri[0]
    let uri = methodAndUri[1]
    let restAndQueryString = uri.split('?')

    // console.log('methodAndUri =>', methodAndUri)
    // console.log('httpMethod =>', httpMethod)
    // console.log('restAndQueryString =>', restAndQueryString)

    let queryString
    let getQueryString = function() {
        if (queryString) {
            return queryString
        }

        let body
        let qs

        if (contentType.indexOf('multipart/form-data') === -1) {
            body = textBody

            if (body && body !== '') {
                return contentType.startsWith('application/json') ? body : URLDecoder.decode(body, 'UTF-8')
            }

            qs = restAndQueryString[1]
            qs = (!qs) ? '' : URLDecoder.decode(qs, 'UTF-8')
        }

        queryString = qs
        // print('queryString =>', queryString)
        return qs
    }

    /**
     * @function {getParts} - Retorna uma coleção de '*javax.servlet.http.Parts*', que por definição
     *  *"represents a part as uploaded to the server as part of a multipart/form-data
     * request body. The part may represent either an uploaded file or form data."*
     * @return {type} {description}
     */
    let parts = function() {
        if (contentType.indexOf('multipart/form-data') === -1) { return [] }

        return httpRequest.getParts().toArray()
    }

    return {
        httpRequest: httpChannel,

        get queryString() { return getQueryString() },

        rest: restAndQueryString[0],

        contentType: contentType,

        method: httpMethod,

        requestURI: uri,

        pathInfo: '',

        scheme: '',

        // host: headers.Host,
        get host() { return getHeaders().Host },

        // port: headers.Port,
        get port() { return getHeaders().Port },

        // cookies: headers.Cookie,
        get cookies() { return getHeaders().Cookie },

        // headers: headers,
        get headers() { return getHeaders() },

        contextPath: '',

        servletPath: '',

        parts: parts
    }
}

function mountResponse(channel) {
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
            let response = new JString('HTTP/1.1 200 OK\r\n' + 'Date: ' + new Date().toString() + '\r\n' +
                'Content-Type: text/plain\r\n' + 'Server: thrust\r\n' +
                'Connection: close\r\n')

            Object
                .keys(this.headers)
                .forEach(header => {
                    response += `${header}: ${this.headers[header]}\r\n`
                })

            response += '\r\n' + content 

            channel.write(StandardCharsets.UTF_8.encode(response))
            channel.close()
        },

        json: function(data, headers = this.headers) {
            const body = (typeof (data) === 'object') ? JSON.stringify(data) : data

            let response = new JString('HTTP/1.1 200 OK\r\n' + 'Date: ' + new Date().toString() + '\r\n' +
                'Content-Type: application/json\r\n'  +
                'Server: thrust\r\n' + 'Connection: close\r\n' )

            Object
                .keys(headers)
                .forEach(header => {
                    response += `${header}: ${headers[header]}\r\n`
                })

            response += '\r\n' + body

            channel.write(StandardCharsets.UTF_8.encode(response))
            channel.close()
        },

        html: function(content) {
            let response = new JString('HTTP/1.1 200 OK\r\n' + 'Date: ' + new Date().toString() + '\r\n' +
                'Content-Type: text/html\r\n' + 'Server: thrust\r\n' +
                'Connection: close\r\n')

            Object
                .keys(this.headers)
                .forEach(header => {
                    response += `${header}: ${this.headers[header]}\r\n`
                })

            response += '\r\n' + content    

            channel.write(StandardCharsets.UTF_8.encode(response))
            channel.close()
        },

        binary: function(content) {
            let response = new JString('HTTP/1.1 200 OK\r\n' + 'Date: ' + new Date().toString() + '\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Server: thrust\r\n' + 'Connection: close\r\n')

            Object
                .keys(this.headers)
                .forEach(header => {
                    response += `${header}: ${this.headers[header]}\r\n`
                })

            response += '\r\n'    

            channel.write(StandardCharsets.UTF_8.encode(response))
            channel.write(ByteBuffer.wrap(content))
            channel.close()
        },

        /**
         * Objeto que encapsula os métodos de retornos quando ocorre um erro na requisição http.
         * @ignore
         */
        error: {
            /**
             * Escreve em formato *JSON* uma mensagem de erro como resposta a requisição. 
             * Modifica o valor
             * do *content-type* para *'application/json'*.
             * @alias error.json
             * @memberof! http.Response#
             * @instance error.json
             * @param {String} message - mensagem de erro a ser enviada no retorno da chamada do browser.
             * @param {Number} statusCode - (opcional) status de retorno do request htttp.
             * @param {Object} headers - (opcional) configurações a serem definidas no header http.
             */
            json: function(data, statusCode, headers) {
                let code = statusCode || 200
                let body = JSON.stringify(data)
                let textResponse = 'HTTP/1.1 ' + RESPONSE_CODES[code] + '\r\n' +
                    'Date: ' + new Date().toString() + '\r\n' +
                    'Content-Type: application/json\r\n' +
                    'Connection: close\r\n'

                for (let opt in (headers || {})) {
                    textResponse += opt + ': ' + headers[opt] + '\r\n'
                }

                textResponse += '\r\n' + body

                channel.write(StandardCharsets.UTF_8.encode(textResponse))
                channel.close()
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

    if (strParams !== null && strParams !== '') {
        if (contentType && contentType.startsWith('application/json')) {
            params = JSON.parse(strParams)
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
