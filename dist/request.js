const JString = Java.type('java.lang.String')
const ByteBuffer = Java.type('java.nio.ByteBuffer')
const URLDecoder = Java.type('java.net.URLDecoder')
const StandardCharsets = Java.type('java.nio.charset.StandardCharsets')
const FileOutputStream = Java.type('java.io.FileOutputStream')
const File = Java.type('java.io.File')

const readChannel = (httpChannel, buffer) => {
    let len = httpChannel.read(buffer)

    if (len < 0) {
        console.log('\n\t\t CLOSING \n\n')
        httpChannel.close()
        return
    }

    while (len > 0) {
        // console.log('\n=====\n' + new JString(buffer.array(), 0, buffer.position(), StandardCharsets.UTF_8))
        console.log('\r\r\r\r\r\r\r\r\r\r', len, ' => ', buffer.position())
        buffer.flip()
        buffer.clear()
        // java.lang.Thread.sleep(1)
        len = httpChannel.read(buffer)
    }

    console.log('--- FIM -------------------------------------------------------------\n\n\n');

    html(httpChannel, page)
}

function mountHeader(textHeaders) {
    let headers = {}

    for (let i = 1; i < textHeaders.length; i++) {
        let p = 0
        let hdr = textHeaders[i].split(/:\s*/g)
        let key = hdr[p++]

        if (key === 'Host') {
            headers[key] = hdr[p++]
            headers['Port'] = (hdr[p]) ? hdr[p] : '80'
        } else {
            if (hdr.length > 2) {
                hdr.shift()
                headers[key] = hdr.join(':')
            } else {
                headers[key] = hdr[p]
            }
        }
    }

    return headers
}

function matchBoundary(bufferArray, pointer, boundary) {
    for (let i = pointer, n = 0; n < boundary.length; i++ , n++) {
        if (bufferArray[i] != boundary.charCodeAt(n))
            return false
    }
    return true
}

function getDataPositions(buffer, bufferArray, pointer, boundary) {
    let start = pointer
    let positions = []

    while (pointer < buffer.position()) {
        if (matchBoundary(bufferArray, pointer, boundary)) {
            positions.push({ start, finish: pointer })
            pointer += boundary.length
            start = pointer
        }
        pointer++
    }
    if (bufferArray[pointer - 4] !== 45 || bufferArray[pointer - 3] !== 45 ||
        bufferArray[pointer - 2] !== 13 || bufferArray[pointer - 1] !== 10) {
        positions.push({ start, finish: pointer })
    }

    return (positions.length === 0) ? [{ start, finish: buffer.position() }] : positions
}

function processFormDataRequest(httpChannel, buffer, contentType, headerAndBody) {
    let bufferArray = buffer.array()
    let bytesRead = buffer.position()
    let boundary = '\r\n--' + contentType.replace('multipart/form-data; boundary=', '')
    let pointer = headerAndBody[0].length + 2 + boundary.length
    let dataPositions = []
    let stream = null
    // let ecom = ''
    let qs = {}

    dataPositions = getDataPositions(buffer, bufferArray, pointer, boundary)
    // console.log('### positions =>   [', JSON.stringify(dataPositions), ']')

    while (bytesRead > 0) {
        let reFormDataField = /\r\nContent-Disposition:\sform-data;\sname="(\w+)"[\r\n]+([^]*)/mi
        let reFormDataFile = /\r\nContent-Disposition:\sform-data;\sname="(\w+)";\s+(filename)="(.*)"[\r\n]+Content-type:\s(.+)\r\n/mi

        dataPositions.forEach((pos, idx) => {
            let data = new JString(bufferArray, pos.start, pos.finish - pos.start, StandardCharsets.UTF_8)
            let groups

            if (!data.startsWith('--\r\n')) {

                if ((groups = reFormDataFile.exec(data)) != null) {
                    qs.files = qs.files || {}
                    qs.files[groups[1]] = {
                        name: groups[1],
                        filename: groups[3],
                        'Content-Type': groups[4],
                        // TODO
                        // save: (filename) => moveFile('./tmp/'+groups[3], filename)
                    }
                    if (stream) {
                        stream.close()
                        stream = null
                    }
                    pointer = pos.start + groups[0].length + 2
                    if (groups[3] && groups[3] !== '') {
                        stream = new FileOutputStream('./tmp/' + groups[3])

                        pos.length = pos.finish - pointer
                        stream.write(bufferArray, pointer, pos.finish - pointer)
                    }
                } else if ((groups = reFormDataField.exec(data)) != null) {
                    qs[groups[1]] = groups[2]

                } else {
                    if (stream) {
                        pos.length = pos.finish - pos.start
                        stream.write(bufferArray, pos.start, pos.finish - pos.start)
                    }
                }
            }
        })

        buffer.flip()
        buffer.clear()
        bytesRead = httpChannel.read(buffer)
        dataPositions = getDataPositions(buffer, bufferArray, 0, boundary)
    }

    if (stream) {
        stream.close()
        stream = null
    }

    return qs
}

function mountRequest(httpChannel, buffer) {
    let bytesRead = httpChannel.read(buffer)

    if (bytesRead < 0) {
        // httpChannel.close()
        throw ({ name: 'ThrustExecption', message: 'Error reading http channel.', closeChannel: true })
    }

    let textRequest = new JString(buffer.array(), 0, buffer.position(), StandardCharsets.UTF_8)
    let headerAndBody = textRequest.split('\r\n\r\n')
    let textHeaders = headerAndBody[0].split('\r\n')
    let headers = mountHeader(textHeaders)
    let contentType = headers['Content-Type'] || ''
    let methodAndUri = textHeaders[0].split(' ')
    let httpMethod = methodAndUri[0]
    let uri = methodAndUri[1]
    let restAndQueryString = uri.split('?')
    let queryString

    // console.log('textRequest =>', textRequest, '\n\n')
    // console.log('headers =>', JSON.stringify(headers, null, 4))

    if (!contentType.startsWith('multipart/form-data')) {
        let textBody = headerAndBody[1]

        if (textBody && textBody !== '') {
            queryString = contentType.startsWith('application/json') ? textBody : URLDecoder.decode(textBody, 'UTF-8')
        } else {
            queryString = (!restAndQueryString[1]) ? '' : URLDecoder.decode(restAndQueryString[1], 'UTF-8')
        }
    } else {
        queryString = processFormDataRequest(httpChannel, buffer, contentType, headerAndBody)
    }

    buffer.flip()
    buffer.clear()

    return {
        httpRequest: httpChannel,

        queryString,

        rest: restAndQueryString[0],

        contentType: contentType,

        method: httpMethod,

        requestURI: uri,

        pathInfo: '',

        scheme: '',

        host: headers.Host,

        port: headers.Port,

        cookies: headers.Cookie,

        headers: headers,

        contextPath: '',

        servletPath: ''
    }
}

exports = mountRequest
