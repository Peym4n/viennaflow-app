export default function GET(req, res) {
  res.setHeader("Content-Type", "text/plain");
  res.status(200).send("Hello from Vercel!");
}
