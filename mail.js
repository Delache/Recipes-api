const nodemailer = require('nodemailer');
const dotenv = require('dotenv')
const urljoin = require('url-join')

dotenv.config()

const transporter = nodemailer.createTransport({
    service: process.env.TM_SMTP_SERVICE,
    auth: { 
        user: process.env.TM_SMTP_USER,
        pass: process.env.TM_SMTP_PASS,
    },
    debug: true, 
    logger: true
})

const sendEmail = function (uuid, email, randompassword) {
    const mailOptions = {
        from: process.env.TM_SMTP_USER,
        to: email,
        subject: 'Confirmation d\'inscription à FamilyRecipes',
        html:"<h3>Bonjour, vous avez fait une demande d'inscription chez nous !</h3><p>Pour valider votre inscription, <a href='" + urljoin(process.env.TM_URI, "signin", "validate", uuid) + "'>cliquez ici</a></p><p>Votre mot de passe est: " + randompassword + '</p>'
    }
    console.log(mailOptions)

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error)
        } else {
            console.log('Email sent: ' + info.response)
        }
    })
}

const sendRelationshipMail = function (uuid, email, randompassword, message) {
    const mailOptions = {
        from: process.env.TM_SMTP_USER,
        to: email,
        subject: 'Invitation',
        html:"Vous avez reçu une invitation pour partager vos recettes de cuisine entre amis ! \n \n <h3>"+ message +"</h3><p>Pour vous inscrire,  <a href='" + urljoin(process.env.TM_URI, "signin", "validate", uuid) + "'>cliquez ici</a></p><p>Votre mot de passe est: " + randompassword + '</p>'
    }

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    })
}

const sendPasswordMail = function (email, randompassword) {
    const mailOptions = {
        from: process.env.TM_SMTP_USER,
        to: email,
        subject: 'Votre nouveau mot de passe pour "Popote entre potes"',
        html:'<h3>Bonjour, vous avez demandé un nouveau mot de passe !</h3><p>Vous pouvez désormais vous connecter avec le code suivant : ' + randompassword + '</p>'
    }
    console.log(mailOptions)

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error)
        } else {
            console.log('Email sent: ' + info.response)
        }
    })
}

module.exports.sendEmail = sendEmail
module.exports.sendRelationshipMail = sendRelationshipMail
module.exports.sendEmail = sendPasswordMail