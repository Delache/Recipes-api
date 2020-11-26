const fetch = require('node-fetch')
const proxy = require('express-http-proxy')
const app = require('express')()
const bodyParser = require('body-parser')
const uuidv1 = require('uuid/v1')
const url = require('url')
const path = require('path')
const generator = require('generate-password')
const crypto = require('crypto')
const dotenv = require('dotenv')
const cookieParser = require('cookie-parser')
const { get } = require('http')
const morgan = require('morgan')
const urljoin = require('url-join')

dotenv.config()
const mail = require('./mail')
const encoding = 'utf8'

const couchdbUrl = process.env.TM_DB_URL
console.log(couchdbUrl)
const couchdbPreCredentials = process.env.TM_DB_USER + ':' + process.env.TM_DB_PASSWORD

const couchdbCredBuf = Buffer.from(couchdbPreCredentials, encoding)
const couchdbCredentials = couchdbCredBuf.toString('base64')
const couchdbCredentialsHeader = 'Basic ' + couchdbCredentials;

//const secret = process.env.TM_SECRET

app.use(morgan(process.env.TM_LOGGER_ENV))
app.use(cookieParser())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

app.use((err, req, res, next) => {
    console.error('Error: ' + err + ', Stacktrace: ' + err.stack)
    return res.send(500, 'Something broke! Error: ' + err + ', Stacktrace: ' + err.stack)
})

app.get('/status', async function (req, res) {
    res.send('FamilyBack is up !')
    console.log(req.body)
})

app.use('/sync', proxy(couchdbUrl, {
    filter: function (req, res) {
        console.log(req.body)
        return true;
    }
}))

app.use(function (req, res, next) {
    const allowOrigin = process.env.TM_FRONT_URI
    res.header("Access-Control-Allow-Origin", allowOrigin)
    res.header("Access-Control-Allow-Credentials", "true")
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
    next()
})
 
const fetchPost = async (database, cookie, document) => {
    const rawResponse = await fetch(urljoin(couchdbUrl, database), {
        method: 'POST',
        body: JSON.stringify(document),
        headers: { 
            cookie: 'AuthSession=' + cookie + '; Max-Age=6000;',
            'Content-Type': 'application/json'
        }
    })
    const response = await rawResponse.json()
    return response
}

const fetchGet = async (database, cookie, uuid) => {
    const rawResponse = await fetch(urljoin(couchdbUrl, database, uuid), {
        method: 'GET',
        headers: {
            cookie: 'AuthSession=' + cookie + '; Max-Age=6000;',
            'Content-Type': 'application/json'
        }
    })
    const response = await rawResponse.json()
    return response
}

const rootGet = async (database, uuid) => {
    const rawResponse = await fetch(urljoin(couchdbUrl, database, uuid), {
        method: 'GET',
        headers: {
            Authorization: couchdbCredentialsHeader,
            'Content-Type': 'application/json'
        }
    })
    const response = await rawResponse.json()
    return response
}

const rootPost = async (database, document) => {
    const rawResponse = await fetch(urljoin(couchdbUrl, database), {
        method: 'POST',
        body: JSON.stringify(document),
        headers: {
            Authorization: couchdbCredentialsHeader,
            'Content-Type': 'application/json'
        }
    })
    const response = await rawResponse.json()
    return response
}

const getUserDatabase = async (req) => {
    console.log(req.cookies)
    const rawResponse = await fetch(urljoin(couchdbUrl, '_session'), {
        method: 'GET',
        credentials: 'include',
        headers: {
            cookie: 'AuthSession=' + req.cookies.AuthSession + '; Max-Age=600; Path=/; HttpOnly'
        }
    })
    const response = await rawResponse.json()
    console.log(response)
    return response.userCtx.roles[0]
}

const createRelationshipReplicatorDocs = (from, to) => {
    const first = {
        _id: from + to,
        source: {
            url: urljoin(couchdbUrl, from),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        target: {
            url: urljoin(couchdbUrl, to),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        selector: {
            draft: false,
            "$and": [
                { "type": "recipe" },
                { "author.id_base": to }
            ]
        },
        owner: 'root',
        create_target: false,
        continuous: true
    }
    const second = {
        _id: to + from,
        source: {
            url: urljoin(couchdbUrl, to),
            headers: {
                Authorization: couchdbCredentialsHeader

            }
        },
        target: {
            url: urljoin(couchdbUrl, from),
            headers: {
                Authorization: couchdbCredentialsHeader

            }
        },
        selector: {
            draft: false,
            "$and": [
                { "type": "recipe" },
                { "author.id_base": from }
            ]
        },
        owner: 'root',
        create_target: false,
        continuous: true
    }
    return [first, second]
}

const createSignIn = async (body, from) => {

    // User not already registred ?
    const targetRegistredUser = await rootGet('_users', 'org.couchdb.user:' + req.body.email)
    if (targetRegistredUser.error !== 'not_found') {
        res.json({ ok: false, reason: 'Already registered user' })
        console.log('Already registered user')
    } else {
        // Request for registration not already made ?
        filter = {
            selector: {
                email: { '$eq': body.email },
            }
        }

        const rawResponse = await fetch(urljoin(couchdbUrl, 'sys_signin', '_find'), {
            method: 'POST',
            headers: {
                Authorization: couchdbCredentialsHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(filter)
        })

        const response = await rawResponse.json()
        console.log(response)

        if (response.docs && response.docs.length === 0) {
            const uuid = uuidv1()
            body._id = uuid

            const randompassword = generator.generate({ length: 10, numbers: true })

            body.password = crypto.createHmac('sha256', '')
                .update(randompassword, encoding, 'base64')
                .digest('base64')

            const resp = await rootPost('sys_signin', body)
            console.log(resp)

            if (from === 'signin') {
                mail.sendEmail(uuid, body.email, randompassword)
            }
            else if (from === 'relationship') {
                mail.sendRelationshipMail(uuid, body.email, randompassword, body.message)
            }
        } else {
            console.log('signin found !')
        }
    }
}

const createReplicatorDocs = (uuid) => {
    const first = {
        _id: 'users-' + uuid,
        source: {
            url: urljoin(couchdbUrl, '_users'),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        target: {
            url: urljoin(couchdbUrl, uuid),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        selector: {
            type: 'user',
            roles: {
                '$in': [uuid]
            }
        },
        owner: 'root',
        create_target: false,
        continuous: true
    }
    const second = {
        _id: uuid + '-users',
        target: {
            url: urljoin(couchdbUrl, '_users'),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        source: {
            url: urljoin(couchdbUrl, uuid),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        selector: {
            type: 'user',
            roles: {
                '$in': [uuid]
            }
        },
        owner: 'root',
        create_target: false,
        continuous: true
    }
    const third = {
        _id: uuid + '-relationships',
        target: {
            url: urljoin(couchdbUrl, 'sys_relationships'),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        source: {
            url: urljoin(couchdbUrl, uuid),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        selector: {
            type: 'relationship',
            '$or': [
                { from: uuid },
                { to: uuid }
            ],
        },
        owner: 'root',
        create_target: false,
        continuous: true
    }
    const fourth = {
        _id: 'relationships-' + uuid,
        target: {
            url: urljoin(couchdbUrl, uuid),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        source: {
            url: urljoin(couchdbUrl, 'sys_relationships'),
            headers: {
                Authorization: couchdbCredentialsHeader
            }
        },
        selector: {
            type: 'relationship',
            '$or': [
                { from: uuid },
                { to: uuid }
            ],
        },
        owner: 'root',
        create_target: false,
        continuous: true
    }
    return [first, second, third, fourth] 
}

app.post('/relationship', async function (req, res) {
    const targetUser = await rootGet('_users', 'org.couchdb.user:' + req.body.toEmail)

    // if (targetUser.error === 'not_found') {
    //     console.log('no user registered in db')
    //     await createSignIn({ email: req.body.toEmail , message:req.body.message}, 'relationship')
    //     res.send('Relationship created')
    // } else {
    //     const relationship = {
    //         _id: uuidv1(),
    //         from: req.body.from,
    //         fromSurname: req.body.fromSurname,
    //         fromMail: req.body.fromMail,
    //         //fromUser: JSON.parse(req.body.fromUser),
    //         to: targetUser.roles[0],
    //         toSurname : targetUser.surname,
    //         toMail: targetUser.name,
    //         message: req.body.message,
    //         status: 0,
    //         type: 'relationship'
    //     }
    //     console.log(relationship)
    //     const insertRelationship = await rootPost(req.body.from, relationship)
    //     res.send('Relationship created')
    //     console.log('Relationship created ', insertRelationship)
    // }

    let filter = {
        selector: {
            "$or": [
                { to:  req.body.relationship.to, from: req.body.relationship.from },
                { from:  req.body.relationship.to, to: req.body.relationship.from }
            ]        
        }
    }

    const rawResponse = await fetch(urljoin(couchdbUrl, 'sys_signin', '_find'), {
        method: 'POST',
        headers: {
            Authorization: couchdbCredentialsHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(filter)
    })

    const response = await rawResponse.json()
    
    if (response.docs && response.docs.length === 0) {
        let newUserId;
        if (targetUser.error === 'not_found') {
            console.log('no user registered in db')
            newUserId = await createSignIn(req, res, 'relationship')
            res.send('Relationship created')
        }
      
        req.body.relationship.to = (newUserId !== undefined) ? newUserId : targetUser.roles[0]
        const insertRelationship = await rootPost(req.body.relationship.from, req.body.relationship)
        res.send('Relationship created')
        console.log('Relationship created ', insertRelationship)
    } else {
        res.send('Relationship already existing')
    }
})

app.post('/relationship/validate', async function (req, res) {
    let currentRelationship;
    if (req.cookies !== undefined && req.cookies.AuthSession !== undefined) {
        let userDatabase = await getUserDatabase(req)
            currentRelationship = await fetchGet(userDatabase, req.cookies.AuthSession, req.body.idRelationship)
            currentRelationship.toCompanyDoc =  JSON.parse(req.body.toCompanyDoc)
            currentRelationship.status = 1
        let updateRelationship = await fetchPost(userDatabase, req.cookies.AuthSession, currentRelationship)
    } else {
        currentRelationship = await rootGet('sys_relationships', req.body.idRelationship)
        currentRelationship.toCompanyDoc =  JSON.parse(req.body.toCompanyDoc)
        currentRelationship.status = 1
        let updateRelationship = await rootPost('sys_relationships', currentRelationship)
    }
    const replicationDocs = createRelationshipReplicatorDocs(currentRelationship.from, currentRelationship.to)

    const firstReplicate = await rootPost('_replicator', replicationDocs[0])
    console.log('First replication up !', firstReplicate)

    const secondReplicate = await rootPost('_replicator', replicationDocs[1])
    console.log('Second replication up !', secondReplicate)

    res.send('Relationship updated')
})

app.post('/changepassword', async function (req, res) {
    const urlencoded = new URLSearchParams()
          urlencoded.append('name', req.body.mail)
          urlencoded.append('password', req.body.oldPass)
    let cookie
    let rawResponse = await fetch(urljoin(couchdbUrl, '_session'), {
        method: 'POST',
        body: urlencoded
    })
    let session = await rawResponse.json()
    if (session.ok === true) {
        for (let header of rawResponse.headers) {
            if (header.indexOf('set-cookie') !== -1) {
                cookie = header[1]
                res.cookie(header[1])
            }
        }
        let userRaw = await fetch(urljoin(couchdbUrl, '_users',  'org.couchdb.user:' + req.body.mail), {
            method: 'GET',
            headers: {
                cookie: cookie
            }
        })
        let userToChange = await userRaw.json()
            userToChange.password = req.body.newPass

        let updateUser = await rootPost('_users', userToChange)
        console.log(updateUser)
        res.json({ ok: true, reason: 'Password updated' })

    } else {
        res.json({ ok: false, reason: 'Wrong password' })
    }
})

app.post('/forgetpassword', async (req, res) =>{
    const targetUser = await rootGet('_users', 'org.couchdb.user:' + req.body.email)
    console.log(targetUser)

    if (targetUser.error === 'not_found') {
        console.log('Email send')
        res.json({ ok: false, reason: 'Email or password incorrect' })
    } else {
        const randompassword = generator.generate({ length: 10, numbers: true })
        const newPassword = crypto.createHmac('sha256', '')
            .update(randompassword, 'utf-8', 'base64')
            .digest('base64')

        targetUser.password = newPassword

        let updateUser = await rootPost('_users', targetUser)
        console.log(updateUser)

        mail.sendEmail( req.body.email, randompassword)
        console.log('Email send')
        res.json({ ok: true, reason: 'Email send' })
    }
})
 
app.post('/signin', (req, res) =>{
    try {
        createSignIn(req.body, 'signin')
        res.send('Email sent at ' + new Date())
    } catch (error) {
        res.send(error);
    }
})

app.get('/signin/validate/:id', async function (req, res) {
    let userData = await rootGet('sys_signin', req.params.id)
    console.log(userData)

    if (userData.error === 'not_found') {
        console.log('no user registered in db')
        createSignIn({ email: req.body.email, company: req.body.company }, 'relationship')
        res.send('Relationship created')

    } else {
        if (req.params.id === userData._id) {
            if (userData.companyDB === undefined) {
                const newDBrawResponse = await fetch(urljoin(couchdbUrl, 'db' + userData._id), {
                    method: 'PUT',
                    headers: {
                        Authorization: couchdbCredentialsHeader,
                    }
                })
                const newDBresponse = await newDBrawResponse.json()

                console.log('New DB created ! ' + newDBresponse)

                let user = {
                    _id: 'org.couchdb.user:' + userData.email,
                    mail: userData.email,
                    company: userData.company,
                    roles: (userData.companyDB === undefined) ? ['db' + userData._id] : [userData.companyDB], //add company id to manage db access
                    password: userData.password,
                    firstname: userData.firstname,
                    lastname: userData.lastname,
                    type: 'user'
                }

                let addUser = await rootPost('_users', user)
                console.log('User created ! ' + addUser)

                let companyDoc = {
                    name: userData.company,
                    companyId: userData._id,
                    id_base:'db' + userData._id,
                    type: 'company'
                }

                let addCompanyDoc = await rootPost('db' + userData._id, companyDoc)
                console.log('Added company doc', addCompanyDoc)

                let replicateDocs = createReplicatorDocs('db' + userData._id)

                let firstReplicate = await rootPost('_replicator', replicateDocs[0])
                console.log('First user replication up !', firstReplicate)

                let secondReplicate = await rootPost('_replicator', replicateDocs[1])
                console.log('Second user replication up !', secondReplicate)

                let thirdReplicate = await rootPost('_replicator', replicateDocs[2])
                console.log('First relationship replication up !', thirdReplicate)

                let fourthReplicate = await rootPost('_replicator', replicateDocs[3])
                console.log('Second relationship replication up !', fourthReplicate)
            } else {
                let user = {
                    _id: 'org.couchdb.user:' + userData.email,
                    mail: userData.email,
                    company: userData.company,
                    roles: (userData.companyDB === undefined) ? ['db' + userData._id] : [userData.companyDB], //add company id to manage db access
                    password: userData.password,
                    firstname: userData.firstname,
                    lastname: userData.lastname,
                    admin: (userData.admin === undefined) ? [] : userData.admin,
                    isAdmin: false,
                    type: 'user'
                }
                let addUser = await rootPost('_users', user)
                console.log('User created ! ' + addUser)
            }

            const rawDeleteResponse = await fetch(urljoin(couchdbUrl, 'sys_signin', userData._id, '?rev=' + userData._rev), {
                method: 'DELETE',
                headers: {
                    Authorization: couchdbCredentialsHeader,
                    'Content-Type': 'application/json'
                }
            })
            const responseDelete = await rawDeleteResponse.json()
            // let deleteSignin = await signin.destroy(userData._id, userData._rev)
            console.log('Signin deleted ', responseDelete)
            // res.send('User created !')
            res.redirect(process.env.TM_FRONT_URI)
        } else {
            res.send('Internal server error')
        }
    }
})

app.post('/login', async function (req, res) {
    const urlencoded = new URLSearchParams()
          urlencoded.append('name', req.body.email)
          urlencoded.append('password', req.body.password)
    let cookie

    let rawResponse = await fetch(urljoin(couchdbUrl, '_session'), {
        method: 'POST',
        body: urlencoded
    })
    let session = await rawResponse.json()

    if (session.ok === true) {
        for (let header of rawResponse.headers) {
            if (header.indexOf('set-cookie') !== -1) {
                console.log(header[1])
                cookie = header[1]
                res.cookie(header[1])
            }
        }

        const userRawUrl = urljoin(couchdbUrl, '_users',  'org.couchdb.user:' + session.name)
        console.log(userRawUrl)
        let userRaw = await fetch(userRawUrl, {
            method: 'GET',
            headers: {
                cookie: cookie
            }
        })
        let user = await userRaw.json()
        console.log(user)
        let loginResponse = { ...session, user }
        console.log(loginResponse)
        res.json(loginResponse)
    } else {
        res.json({ ok: false, reason: 'Email or password incorrect' })
    }
})

app.get('/version', async function (req, res) {
    let data = await fetch(couchdbUrl)
    let dataJson = await data.json()
    res.json(dataJson)
})

app.get('/db/_all_dbs', function (req, res) {
    res.send('Not available')
})

app.listen(process.env.TM_PORT, process.env.TM_ADDRESS, function () {
    console.log('Listening on ' + process.env.TM_PORT)
})

