import { handlePaymentWebhook } from '@/features/checkout'

// The one route handler of the repo (ADR-0021): a gateway's webhook, and the browser of the test gateway forwarding
// its signed event. No logic here, and no GET: Next.js answers any other method with 405.
export const POST = async (request: Request): Promise<Response> => handlePaymentWebhook(request)
