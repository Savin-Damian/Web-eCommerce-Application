const cookieParser=require('cookie-parser');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser') 
const fs = require('fs').promises;

const app = express();
app.use(cookieParser());
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const port = 6789; 

var mysql = require('mysql2');
var con = mysql.createConnection({
    host: "localhost",
    user: "root",
    port:3306,
    password: "bazadedate",
    database: "cumparaturi"
  });

// directorul 'views' va conține fișierele .ejs (html + js executat la server)
app.set('view engine', 'ejs');
// suport pentru layout-uri - implicit fișierul care reprezintă template-ul site-ului  este views/layout.ejs
app.use(expressLayouts);
// directorul 'public' va conține toate resursele accesibile direct de către client (e.g., fișiere css, javascript, imagini)
app.use(express.static('public'));
// corpul mesajului poate fi interpretat ca json; datele de la formular se găsesc în format json în req.body
app.use(bodyParser.json());
// utilizarea unui algoritm de deep parsing care suportă obiecte în obiecte
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: 'secret', 
    resave: false,
    saveUninitialized: true
}));

// Middleware add utilizatorul la res.locals
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

/*Lab13 tema3a*/
// Limitator  IP
const loginLimiterByIP = rateLimit({
    windowMs: 5 * 60 * 1000, 
    max: 3, 
    message: 'Prea multe încercări de autentificare de la această adresă IP, vă rugăm să încercați din nou după 5 minute'
});

// Limitator utilizator
const loginAttempts = {};
const maxAttempts = 3;
const windowMs = 5 * 60 * 1000; 

const loginLimiterByUser = (req, res, next) => {
    const { utilizator } = req.body;
    if (!utilizator) return next();

    const currentTime = Date.now();
    if (!loginAttempts[utilizator]) {
        loginAttempts[utilizator] = { attempts: 1, lastAttempt: currentTime };
    } else {
        const attemptsData = loginAttempts[utilizator];
        if (currentTime - attemptsData.lastAttempt < windowMs) {
            if (attemptsData.attempts >= maxAttempts) {
                return res.status(429).send('Prea multe încercări de autentificare pentru acest utilizator, vă rugăm să încercați din nou după 5 minute');
            }
            attemptsData.attempts++;
        } else {
            attemptsData.attempts = 1;
            attemptsData.lastAttempt = currentTime;
        }
    }
    next();
}; 

/*Lab13 Tema2*/
// Middleware - detecta cereri 404 
const accessAttempts = {};
const blockWindowMs = 30 * 60 * 1000; 
const maxNotFoundAttempts = 5;

const updateAccessAttempts = (ip) => {
    const currentTime = Date.now();
    if (!accessAttempts[ip]) {
        accessAttempts[ip] = [];
    }
    accessAttempts[ip].push(currentTime);
    accessAttempts[ip] = accessAttempts[ip].filter(attemptTime => currentTime - attemptTime < blockWindowMs);
};

const blockIpLimiter = (req, res, next) => {
    const ip = req.ip;
    if (accessAttempts[ip] && accessAttempts[ip].length > maxNotFoundAttempts) {
        return res.status(429).send('Acces blocat temporar pentru accesarea resurselor inexistente.');
    }
    next();
};

app.use(blockIpLimiter);


// la accesarea din browser adresei http://localhost:6789/ se va returna textul 'Hello World'
// proprietățile obiectului Request - req - https://expressjs.com/en/api.html#req
// proprietățile obiectului Response - res - https://expressjs.com/en/api.html#res
app.get('/', (req, res) => {
    const nume_utilizator = req.session.user ? req.session.user.utilizator : null; //req.cookies.utilizator;

    const query = 'SELECT * FROM produse';
    con.query(query, (err, rezultate) => {
    if (err) {
      throw err;
    }
    res.render('index', { nume_utilizator: nume_utilizator, produse: rezultate});
    });
});
// la accesarea din browser adresei http://localhost:6789/chestionar se va apela funcția specificată
let listaIntrebari;

async function citesteIntrebari() {
    try {
        const data = await fs.readFile('intrebari.json', 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Eroare la citire!!!', err);
        return [];
    }
}

app.get('/chestionar', async (req, res) => { 
    listaIntrebari = await citesteIntrebari();

 // în fișierul views/chestionar.ejs este accesibilă variabila 'intrebari' care conține vectorul de întrebări
    res.render('chestionar', {intrebari: listaIntrebari});
});

app.post('/rezultat-chestionar', async (req, res) => { 
    listaIntrebari = await citesteIntrebari();
    const raspunsuri = req.body;
    let corecte = 0;
    let raspunsuriEvidentiate = [];

    listaIntrebari.forEach((intrebare,index)=> {
        const raspuns_corect = intrebare.corect;
        const raspuns_primit = parseInt(raspunsuri[`intrebare${index}`])
        
        if(raspuns_corect === raspuns_primit){ 
            corecte++;
        } 
        raspunsuriEvidentiate.push(raspuns_primit);
    });
    
    res.render('rezultat-chestionar', { intrebari: listaIntrebari,corecte: corecte, total: listaIntrebari.length, raspunsuriEvidentiate:raspunsuriEvidentiate });

});

app.get('/autentificare', async (req, res) => { 
    const mesajEroare = req.cookies.mesajEroare;
    res.render('autentificare' ,{mesajEroare: mesajEroare});

});

app.post('/verificare-autentificare',loginLimiterByIP, loginLimiterByUser, async (req, res) => { 
    console.log(req.body);

    const utilizatoriData = await fs.readFile('utilizatori.json', 'utf8');
    const utilizatori = JSON.parse(utilizatoriData);

    const utilizator = req.body.utilizator;
    const parola = req.body.parola;

    const user = utilizatori.find(u => u.utilizator === utilizator && u.parola === parola);

    if(user){ 

        req.session.user = { utilizator: user.utilizator, nume: user.nume, prenume: user.prenume, rol: user.rol };
        res.clearCookie('mesajEroare');

        res.cookie('utilizator', utilizator, {maxAge:90000, httpOnly: true});
        res.redirect('/');
        

    }
    else { 
        res.cookie('mesajEroare', 'EROARE - Autentificare eșuată - Utilizator/Parola greșită', {maxAge: 90000, httpOnly: true});
        res.redirect('/autentificare');
    }
   
});

app.get('/delogare', (req, res) => {
    req.session.destroy();  
    res.redirect('/');  
});

app.get('/creare-bd', (req,res) => {
     
      con.connect(function(err) {
		if (err) throw err;
		console.log("Connected!");
		con.query("CREATE DATABASE IF NOT EXISTS cumparaturi", function (err, result) {
            if(err) throw err;
		    console.log("Database created");

		    var sql = "CREATE TABLE IF NOT EXISTS produse (id int NOT NULL AUTO_INCREMENT, nume VARCHAR(200) NOT NULL, pret INT NOT NULL, PRIMARY KEY (id))";
            con.query(sql, function (err, result) {
                console.log("Table created");
            });
		});
	  });
	res.redirect('/');

});

app.get('/inserare-bd', (req,res) => {
      
      con.connect(function(err) {
		if (err) throw err;
		console.log("Connected!");
        con.query("DELETE from produse;", function (err, result) {	
            if (err) throw err;
          console.log("1 record deleted");
        });
		
        var sql = "INSERT INTO produse (nume, pret) VALUES ('Top hartie A4',20), ('Contracte personalizate',50),('Diplome și certificate',70), ('Testamente personalizate', 95),('Procuri speciale sau generale',85),('Acte constitutive și documente de înregistrare a firmei',65),('Rapoarte și analize financiare',50),('Scrisori de recomandare personalizate',40),('Rapoarte de piață și studii de fezabilitate',50),('Manuale și ghiduri personalizate',45),('Scrisori și corespondență',35),('Notițe și jurnale',40)";
        con.query(sql,function(err,result){
            if(err) throw err;
            console.log("1 record inserted");
        })
	  });
	res.redirect('/');

});

let cart = [];

app.get('/adaugare_cos', (req, res) => {
	
    cart.push(req.query.id);
    req.session.cos = cart;
    console.log(req.session.cos);
    cartSize=req.session.cos.length;

    res.redirect('/');
});

app.get('/vizualizare_cos', (req, res) =>{
    
    console.log(req.session.cos);
    if (req.session.cos.length === 0) {
        return res.render('vizualizare-cos', { produse: [] });
    }
    con.connect(function(err) {
    var sql = "SELECT nume, pret FROM produse where ";
    for(var i=0;i<req.session.cos.length-1;i++){
        sql += "id= "+req.session.cos[i] + " OR ";
    }

    sql+= " id ="+req.session.cos[req.session.cos.length-1];
    console.log(sql);
    con.query(sql, function (err, result) {
    if (err) throw err;
    console.log(result);
    res.render('vizualizare-cos', {produse: result});
    });
});
});

app.get('/admin', (req, res) => {
    if(req.session.user && req.session.user.rol ==='ADMIN'){ 
	    res.render('admin');
    }else{
        res.status(403).send('Acces NEPERMIS!');
    }
});

app.post('/adaugare_produs', (req, res) => {
    if (req.session.user && req.session.user.rol === 'ADMIN') {
        const { nume, pret } = req.body;
        const query = 'INSERT INTO produse (nume, pret) VALUES (?, ?)';

        con.query(query, [nume, pret], (err, rezultate) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Eroare la adăugarea produsului');
            }
            res.redirect('/admin?message=success');
        });
    } else {
        res.status(403).send('Acces interzis');
    }
});

app.use((req, res, next) => {
    const ip = req.ip;
    updateAccessAttempts(ip);
    res.status(404).send('Resursa nu a fost găsită');
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('A apărut o eroare pe server!');
});

app.listen(port, () => console.log(`Serverul rulează la adresa http://localhost:`));