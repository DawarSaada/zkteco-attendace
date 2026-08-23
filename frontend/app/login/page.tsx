import { login } from './actions'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const resolvedSearchParams = await searchParams;
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-sm border border-gray-100">
        <h1 className="text-2xl font-bold text-center text-blue-600 mb-8">ZKTeco Admin Login</h1>
        
        <form className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="admin@example.com"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="••••••••"
            />
          </div>

          {resolvedSearchParams?.error && (
            <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
              {resolvedSearchParams.error}
            </p>
          )}

          <button
            formAction={login}
            className="w-full bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}
