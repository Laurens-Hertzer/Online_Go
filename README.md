# Online_Go

This is a online server with a frontend, to play the game go with your friends and strangers.

## Website

This is the link to the website:

https://go.lahdev.ch

**Attention**, this website is deployed on premise, meaning that it might be not online at times.

## Tech Stack

**Client**  
![JS](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)

**Server & Database**  
![Node](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)

**Deployment & Infrastructure**  
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Portainer](https://img.shields.io/badge/Portainer-13BEF9?style=flat&logo=portainer&logoColor=white)
![Caddy](https://img.shields.io/badge/Caddy-1F88C0?style=flat&logo=caddy&logoColor=white)

---

## Deployment & Setup

This application is fully containerized and designed to run with **Docker Compose** (via **Portainer**).

### 1. Environment Variables

Create a `.env` file in the root directory (or pass these variables via your Portainer Stack environment settings). You can use `.env.example` as a template:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=online_go

DATABASE_URL=postgres://postgres:your_secure_password@postgres:5432/online_go
SESSION_SECRET=a_very_long_random_secret_phrase
NODE_ENV=production
ALLOWED_ORIGIN=[https://your-domain.com](https://your-domain.com)
DB_SSL=false
```

### 2. Run with Docker Compose / Portainer

You can deploy the stack directly in **Portainer** using the Web Editor:

1. Create a new **Stack** in Portainer.
2. Paste the contents of `docker-compose-go.yml` into the Web Editor.
3. Add the required Environment Variables in the Portainer UI.
4. Click **Deploy the stack**.

Alternatively, run locally via CLI:

```bash
docker compose -f docker-compose-go.yml up -d --build
```

## Lessons Learned

This project is my introduction into WebSockets and several other technologies, as for example CORS (Cross-Origin Resource Sharing), deeper knowledge in used practices environment variables/.env files, package.json and gitignore. 

## Feedback/Support

If you have any feedback or need support, please reach out over GitHub Issues.

## Roadmap

- Proper account page for account personalization (and deletion)
- Design improvements (design framework, Canvas API)
- Chat
- Swear words filter in chat
- Training page
- Socials (Teams/Orgs/Clubs, Friends, Leaderboard)
- Much more :)

## Feedback/Support

If you have any feedback or need support, please reach out over GitHub Issues or over my Email 
