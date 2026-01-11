const express = require('express');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

// --- SETUP ---
const app = express();
const prisma = new PrismaClient();
const PORT = 3000;
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session
app.use(session({
    store: new pgSession({ conObject: { connectionString: process.env.DATABASE_URL } }),
    secret: 'focode_secure_secret_99',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// Middleware
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    // Default image fallback for views
    res.locals.fallbackImage = 'https://focode.org/ethan/img/museremu.jpeg'; 
    next();
});

function isAuthenticated(req, res, next) {
    if (req.session.userId) return next();
    res.redirect('/admin/login');
}

function getImagePath(req) {
    if (req.file) return '/uploads/' + req.file.filename;
    if (req.body.imageUrl && req.body.imageUrl.trim() !== '') return req.body.imageUrl.trim();
    return req.body.existingImage || '';
}

// --- PUBLIC ROUTES ---

app.get('/', (req, res) => res.redirect('/page/1'));

// MAIN PAGE LOGIC (Fixed)
app.get('/page/:num', async (req, res) => {
    const page = Math.max(1, parseInt(req.params.num) || 1);
    const itemsPerPage = 9;

    try {
        // 1. Fetch Reports (Specific Query for the Reports Section)
        const recentReports = await prisma.article.findMany({
            where: { published: true, category: 'REPORT' },
            orderBy: { createdAt: 'desc' },
            take: 4
        });

        // 2. Fetch News (For Magazine Section)
        const newsQuery = { published: true, category: { not: 'REPORT' } }; 
        const totalNews = await prisma.article.count({ where: newsQuery });
        const totalPages = Math.max(1, Math.ceil(totalNews / itemsPerPage));

        const newsItems = await prisma.article.findMany({
            where: newsQuery,
            orderBy: { createdAt: 'desc' }, // Fix: Newest First
            skip: (page - 1) * itemsPerPage,
            take: itemsPerPage,
            include: { author: { select: { name: true } } }
        });

        // 3. Assign Slots (Safe slicing)
        // Feature the first item, list the next 4
        const featMain = newsItems.length > 0 ? newsItems[0] : null;
        const featSide = newsItems.length > 1 ? newsItems.slice(1, 5) : [];
        
        // Grid gets the rest (if any) or simplified for pagination pages
        // On page 1, we show Featured + Side. On page 2+, just a grid.
        
        res.render('index', { 
            page, 
            totalPages, 
            reports: recentReports, // Pass reports explicitly
            featMain, 
            featSide, 
            gridItems: newsItems, // Pass all fetched news for flexibility
            isHome: true 
        });

    } catch (e) {
        console.error(e);
        res.status(500).send("Server Error");
    }
});

// ARTICLE PAGE (Fixed Draft Security)
app.get('/article/:slug', async (req, res) => {
    const article = await prisma.article.findUnique({
        where: { slug: req.params.slug },
        include: { author: { select: { name: true } } }
    });

    // Fix: Prevent access to unpublished articles (unless logged in)
    const isAdmin = !!req.session.userId;
    if (!article || (!article.published && !isAdmin)) {
        return res.status(404).render('index', { 
            page: 1, totalPages: 1, reports: [], featMain: null, featSide: [], gridItems: [], isHome: false 
        }); // Ideally render a dedicated 404 page
    }

    res.render('article', { article, isHome: false });
});

// --- MISSING ROUTES (Fixed 404s) ---

// Reports Archive
app.get('/category/reports', async (req, res) => {
    const reports = await prisma.article.findMany({
        where: { published: true, category: 'REPORT' },
        orderBy: { createdAt: 'desc' }
    });
    res.render('index', { 
        page: 1, totalPages: 1, 
        reports: [], featMain: null, featSide: [], 
        gridItems: reports, // Show reports in the main grid area
        isHome: false,
        sectionTitle: "Tous les Rapports"
    });
});

// General Categories (Ndondeza, etc)
app.get('/category/:cat', async (req, res) => {
    const catName = req.params.cat.toUpperCase();
    const articles = await prisma.article.findMany({
        where: { published: true, category: catName },
        orderBy: { createdAt: 'desc' }
    });
    res.render('index', { 
        page: 1, totalPages: 1, 
        reports: [], featMain: null, featSide: [], 
        gridItems: articles,
        isHome: false,
        sectionTitle: `Catégorie : ${req.params.cat}`
    });
});

// Static Pages
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/reports', (req, res) => res.redirect('/category/reports'));

// --- ADMIN ROUTES ---

app.get('/admin/login', (req, res) => res.render('admin/login'));

app.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user.id;
        // Security: Remove password before storing in session
        const safeUser = { ...user };
        delete safeUser.password;
        req.session.user = safeUser;
        
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin/login', { error: "Invalid Credentials" });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

app.get('/admin/dashboard', isAuthenticated, async (req, res) => {
    const articles = await prisma.article.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { author: { select: { name: true } } }
    });
    res.render('admin/dashboard', { articles });
});

app.get('/admin/new', isAuthenticated, (req, res) => res.render('admin/editor', { article: null }));

// CREATE
app.post('/admin/save', isAuthenticated, upload.single('image'), async (req, res) => {
    const { title, html, category, date, slug, published, summary } = req.body;
    const imagePath = getImagePath(req);
    
    // Logic: Auto-generate slug if empty
    const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();

    // Security: Sanitize HTML
    const cleanHtml = DOMPurify.sanitize(html);

    await prisma.article.create({
        data: {
            title, 
            html: cleanHtml, 
            summary: summary || '', // Save summary
            category,
            slug: finalSlug, 
            image: imagePath,
            date: date || new Date().toDateString(),
            published: !!published,
            authorId: req.session.userId
        }
    });
    res.redirect('/admin/dashboard');
});

// UPDATE
app.get('/admin/edit/:id', isAuthenticated, async (req, res) => {
    const article = await prisma.article.findUnique({ where: { id: parseInt(req.params.id) } });
    // TODO: Add check if user.role == ADMIN or user.id == article.authorId
    res.render('admin/editor', { article });
});

app.post('/admin/update/:id', isAuthenticated, upload.single('image'), async (req, res) => {
    const { title, html, category, date, published, summary } = req.body;
    const imagePath = getImagePath(req);
    const cleanHtml = DOMPurify.sanitize(html);

    await prisma.article.update({
        where: { id: parseInt(req.params.id) },
        data: {
            title, 
            html: cleanHtml, 
            summary,
            category, 
            image: imagePath, 
            date,
            published: !!published,
            lastEditedById: req.session.userId
        }
    });
    res.redirect('/admin/dashboard');
});

// DELETE (Added Feature)
app.post('/admin/delete/:id', isAuthenticated, async (req, res) => {
    if (req.session.user.role !== 'ADMIN') return res.status(403).send("Unauthorized");
    await prisma.article.delete({ where: { id: parseInt(req.params.id) } });
    res.redirect('/admin/dashboard');
});

// USER MANAGER
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
        await prisma.user.create({ data: { name, email, password: hashedPassword, role } });
        res.redirect('/admin/users');
    } catch(e) {
        res.send("Error creating user.");
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));