This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the live honeypot dashboard.

The dashboard is fully powered by Next.js route handlers. No separate websocket or tailing process is required.

## Honeypot Feed API

The dashboard polls this endpoint every 3 seconds:

- `GET /api/honeypot/events?limit=120`

Filters are supported via query params:

- `severity=high|medium|low`
- `protocol=TCP|UDP`
- `country=US` (ISO-like code)
- `port=22`
- `q=ssh` (matches IP/service/action)
- `sinceMinutes=15`

You can push real honeypot events into the dashboard:

- `POST /api/honeypot/events`
- `POST /api/honeypot/cowrie` (Cowrie JSON directly)

Example payload:

```json
{
	"srcIp": "185.22.44.10",
	"country": "RU",
	"protocol": "TCP",
	"port": 22,
	"service": "SSH",
	"severity": "high",
	"action": "Brute force burst",
	"payloadSize": 512
}
```

You may also send an array of events in one request.

## Live stream

The dashboard uses the Next.js streaming endpoint:

- `GET /api/honeypot/stream`

This powers live updates in the browser with Server-Sent Events.

## Cowrie ingest

Send Cowrie JSON directly to:

- `POST /api/honeypot/cowrie`

If you want to forward Cowrie logs, point your own log shipper at that route.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
