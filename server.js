const express = require('express');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');

const app = express();
const prisma = new PrismaClient();
const PORT = 3000;

// --- CONFIGURATION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true })); // Handle forms
app.use(express.json());

// Session Setup (Login Memory)
app.use(session({
    store: new pgSession({ conObject: { connectionString: process.env.DATABASE_URL } }),
    secret: 'focode_secret_key_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// Upload Setup (Images)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// Middleware: Protect Admin Routes
function isAuthenticated(req, res, next) {
    if (req.session.userId) return next();
    res.redirect('/admin/login');
}

// Global Variables for Views
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- PUBLIC ROUTES (Front Office) ---

app.get('/', (req, res) => res.redirect('/page/1'));

app.get('/page/:num', async (req, res) => {
    const page = parseInt(req.params.num) || 1;
    const itemsPerPage = 9;
    
    // Get only PUBLISHED articles
    const where = { published: true };
    
    const totalArticles = await prisma.article.count({ where });
    const totalPages = Math.ceil((totalArticles - 6) / itemsPerPage); 

    const allArticles = await prisma.article.findMany({
        where,
        orderBy: { id: 'asc' }, // Newest first
        include: { author: true } // Include author name
    });

    // ... (Your existing Grid Logic here: hero, featured, gridItems) ...
    // Placeholder to keep code short:
    const hero = allArticles[0];
    const featMain = allArticles[1];
    const featSide = allArticles.slice(2, 6);
    const gridItems = allArticles.slice(6 + (page-1)*itemsPerPage, 6 + page*itemsPerPage);

    res.render('index', { page, totalPages, hero, featMain, featSide, gridItems, isHome: true });
});

app.get('/article/:slug', async (req, res) => {
    const article = await prisma.article.findUnique({
        where: { slug: req.params.slug },
        include: { author: true, editor: true } // Get Author/Editor info
    });
    if (article) res.render('article', { article, isHome: false });
    else res.status(404).send("Not Found");
});

app.get('/about', (req, res) => res.render('about', { isHome: false }));


// --- ADMIN ROUTES (Back Office) ---

// 1. Login Page
app.get('/admin/login', (req, res) => res.render('admin/login'));

app.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user.id;
        req.session.user = user;
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin/login', { error: "Invalid Credentials" });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// 2. Dashboard (List Articles)
app.get('/admin/dashboard', isAuthenticated, async (req, res) => {
    const articles = await prisma.article.findMany({
        orderBy: { updatedAt: 'asc' },
        include: { author: true, editor: true }
    });
    res.render('admin/dashboard', { articles });
});

// 3. Create New
app.get('/admin/new', isAuthenticated, (req, res) => res.render('admin/editor', { article: null }));

function getImagePath(req) {
    if (req.file) {
        // Priority 1: User uploaded a new file
        return '/uploads/' + req.file.filename;
    } else if (req.body.imageUrl && req.body.imageUrl.trim() !== '') {
        // Priority 2: User pasted a URL (http://...)
        return req.body.imageUrl.trim();
    } else {
        // Priority 3: Keep existing image
        return req.body.existingImage;
    }
}

// 3. Create New
app.post('/admin/save', isAuthenticated, upload.single('image'), async (req, res) => {
    const { title, html, category, date, slug, published } = req.body;
    
    // Use the helper
    const imagePath = getImagePath(req);

    const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    try {
        await prisma.article.create({
            data: {
                title, html, category,
                slug: finalSlug + '-' + Date.now(),
                image: imagePath, // Saves URL or File path
                date: date || new Date().toDateString(),
                published: !!published,
                authorId: req.session.userId
            }
        });
        res.redirect('/admin/dashboard');
    } catch (e) {
        res.status(500).send("Error saving article: " + e.message);
    }
});

// 4. Edit Existing
app.get('/admin/edit/:id', isAuthenticated, async (req, res) => {
    const article = await prisma.article.findUnique({ where: { id: parseInt(req.params.id) } });
    res.render('admin/editor', { article });
});

app.post('/admin/update/:id', isAuthenticated, upload.single('image'), async (req, res) => {
    const { title, html, category, date, published } = req.body;
    
    // Use the helper
    const imagePath = getImagePath(req);

    try {
        await prisma.article.update({
            where: { id: parseInt(req.params.id) },
            data: {
                title, html, category, 
                image: imagePath, // Update image
                date,
                published: !!published,
                lastEditedById: req.session.userId
            }
        });
        res.redirect('/admin/dashboard');
    } catch (e) {
        res.status(500).send("Error updating article: " + e.message);
    }
});

// 5. User Management (Admin Only)
app.get('/admin/users', isAuthenticated, async (req, res) => {
    if (req.session.user.role !== 'ADMIN') return res.redirect('/admin/dashboard');
    const users = await prisma.user.findMany();
    res.render('admin/users', { users });
});

app.post('/admin/users/create', isAuthenticated, async (req, res) => {
    if (req.session.user.role !== 'ADMIN') return res.status(403).send("Unauthorized");
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    try {
        await prisma.user.create({
            data: { name, email, password: hashedPassword, role }
        });
        res.redirect('/admin/users');
    } catch(e) {
        res.send("Error creating user (Email might exist)");
    }
});

// 1. Show Contact Page
app.get('/contact', (req, res) => {
    res.render('contact', { isHome: false, page: 'contact' });
});

// 2. Handle Contact Form Submission
app.post('/contact', (req, res) => {
    const { name, email, message } = req.body;
    
    // In a real app, you would send an email here using 'nodemailer'
    console.log(`📩 NEW MESSAGE from ${name} (${email}): \n${message}`);
    
    // Redirect back to contact page (you can add ?success=true to show a popup)
    res.redirect('/contact'); 
});

// 3. Handle Newsletter Subscription (from the footer/action strip)
app.post('/subscribe', (req, res) => {
    const { email } = req.body;
    console.log(`🔔 NEW SUBSCRIBER: ${email}`);
    // Save to your database here
    res.redirect('back');
});

// 4. Secure Submission Placeholder (Whistleblowers)
app.get('/secure-submission', (req, res) => {
    // For now, redirect to contact or render a specific secure page instructions
    res.render('contact', { isHome: false, page: 'secure' }); 
});

// 5. Donation Placeholder
app.get('/don', (req, res) => {
    res.render('don', { isHome: false, page: 'don' });
});

app.get('/impact', (req, res) => {
    res.render('impact', { isHome:false, page: 'impact'});
});


app.listen(PORT, () => {
    console.log(`🚀 CMS Server running on port ${PORT}`);
});