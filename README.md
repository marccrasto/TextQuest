# TextQuest

TextQuest is an AI-powered educational web application that transforms textbook excerpts into lightweight RPG learning worlds.

It takes textbook content, generates an RPG blueprint and narrative, and lets users play through short learning sequences while building mastery.

---

## 🚀 Live Demo

Add your deployed URL here

> Note: The hosted version should run in **demo mode** for reliability.  
> Demo mode supports pasted textbook excerpts only. The full local version includes PDF upload and OCR support.

---

## 📌 What It Does

- Create an account and save RPG worlds  
- Paste a textbook excerpt and generate an RPG blueprint  
- Generate a world narrative from the blueprint  
- Play through learning sequences in that world  
- Build mastery as you complete the experience  
- Replay completed sequences after reaching full mastery  

---

## 🧠 How It Works

1. The user provides a textbook excerpt  
2. The backend sends the excerpt to Groq to generate a structured RPG blueprint  
3. The blueprint is saved to the database as a world  
4. A protagonist character is created for that world  
5. A narrative layer is generated from the blueprint  
6. The user plays through the generated learning sequences  
7. Progress and mastery are stored in the database  

---

## ⚙️ How to Use

1. Open the application  
2. Create an account or log in  
3. Paste a textbook excerpt  
4. Click Generate RPG Blueprint  
5. Open the saved world  
6. Generate the world narrative  
7. Click Play World  
8. Complete the learning sequences and build mastery  

---

## ❗ Important Notes About Modes

- `APP_MODE=demo` is for hosted use  
- Demo mode supports pasted textbook excerpts only  
- `APP_MODE=local` enables PDF upload, OCR, and sample PDF download  
- The sample excerpt is available on the homepage in demo mode  
- The sample PDF is available in local mode from `public/samples`  

### Example

**Demo mode**
- Paste textbook excerpt  
- Generate blueprint  
- Generate narrative  
- Play the world  

**Local mode**
- Upload a PDF  
- Extract text  
- Generate blueprint  
- Generate narrative  
- Play the world  

If local-only features are used in demo mode, the app will block them.

---

## 🛠️ Tech Stack

**Frontend**
- HTML  
- CSS  
- JavaScript  

**Backend**
- Node.js  
- Express  

**Database**
- Prisma  
- Supabase Postgres  

**AI**
- Groq API  

**Deployment**
- Vercel for demo mode  

**Other Tools**
- bcryptjs  
- cookie-parser  
- multer  

---

## 💻 Running Locally

To run the full application locally:

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd TextQuest
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your environment file

```bash
cp .env.example .env
```

### 4. Fill in your environment variables

Required:

```env
GROQ_API_KEY=your_groq_api_key
DATABASE_URL=your_supabase_runtime_url
DIRECT_URL=your_supabase_direct_url
SESSION_SECRET=your_session_secret
```

Optional:

```env
OPENAI_API_KEY=your_openai_api_key
GROQ_MODEL=llama-3.1-8b-instant
PORT=3000
APP_MODE=local
```

### 5. Generate the Prisma client

```bash
npm run db:generate
```

### 6. Run the application

```bash
npm start
```

### 7. Open in browser

```text
http://localhost:3000
```

---

## 🎯 Why This Project

This project focuses on turning textbook material into a playable learning experience.

It goes beyond simple content generation and emphasizes:
- interactive educational design  
- AI-generated worldbuilding  
- full-stack application structure  
- saved progress and mastery systems  
- deployable proof-of-concept gameplay  

---

## ⚠️ Limitations

- Demo mode does not support PDF upload or OCR  
- Generated content quality depends on the source excerpt and AI response quality  
- Hosted mode is intentionally scoped as a proof-of-concept  
- OCR and local file workflows are intended for local development only  

---

## 🔮 Future Improvements

- Richer world and narrative generation  
- Better question quality and encounter variety  
- More visual gameplay presentation  
- Improved progress analytics and mastery reporting  
- Cleaner deployment and scaling strategy for non-demo mode  

---
