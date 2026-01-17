async function getHealth() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const res = await fetch(`${baseUrl}/health`, { cache: "no-store" });
  if (!res.ok) {
    return { status: "error", service: "pharmaguard-api" };
  }
  return res.json();
}

export default async function Home() {
  const health = await getHealth();

  return (
    <main className="min-h-screen p-10">
      <h1 className="text-4xl font-bold">PharmaGuard AI</h1>
      <p className="mt-4 text-lg text-gray-600">
        A citation-backed drug safety and interaction copilot.
      </p>

      <div className="mt-8 rounded-xl border p-6">
        <p className="font-medium">Backend status</p>
        <pre className="mt-3 rounded-lg bg-gray-100 p-4 text-sm">
          {JSON.stringify(health, null, 2)}
        </pre>
      </div>
    </main>
  );
}
