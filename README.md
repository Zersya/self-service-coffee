# Coffee Self-Service QRIS - Honesty Bar

A self-service coffee payment application using Midtrans QRIS. Customers can pay for coffee based on the grams they consume.

## Features

- **QRIS Payment Integration** - Secure payments via Midtrans Snap
- **Gram-based Pricing** - Calculate payment based on coffee grams used
- **Real-time Dashboard** - View order history and total revenue
- **Order Management** - Cancel pending orders or continue payment

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables in `.env.local`:
   - `GEMINI_API_KEY` - Your Gemini API key
   - `MIDTRANS_SERVER_KEY` - Midtrans server key
   - `MIDTRANS_CLIENT_KEY` - Midtrans client key
   - `DATABASE_URL` - PostgreSQL database URL

3. Run database migrations:
   ```bash
   npm run db:push
   ```

4. Start the app:
   ```bash
   npm run dev
   ```

## Tech Stack

- React + TypeScript
- Express.js backend
- Tailwind CSS
- Midtrans Payment Gateway
- Drizzle ORM

## License

MIT
