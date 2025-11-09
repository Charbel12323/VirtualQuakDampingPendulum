# VirtualQuakDampingPendulum

## 🏗️ Earthquake Building Simulation with AI Optimization

A comprehensive earthquake simulation platform featuring real-time structural analysis and **AI-powered optimization recommendations** using OpenAI GPT-4o.

## ✨ New Feature: AI Optimization Assistant

Get intelligent, cost-effective recommendations to improve your building's earthquake safety!

- 🤖 **GPT-4o Integration**: Advanced AI analysis of simulation results
- 💰 **Cost Optimization**: Prioritized recommendations by ROI
- 🎯 **Smart Detection**: Identifies resonance, soft stories, and critical issues
- 📊 **Comprehensive Analysis**: Evaluates 30+ parameters for optimal safety
- ✅ **Code Compliance**: Automatic building code checks
- 🔧 **One-Click Application**: Apply AI-recommended parameter changes instantly!

### Quick Start
See **[QUICK_START.md](QUICK_START.md)** for 2-minute setup instructions!

### Full Documentation
Read **[AI_OPTIMIZATION_README.md](AI_OPTIMIZATION_README.md)** for complete details.

## How It Works

1. **Configure Building**: Set floors, material, structural system, and parameters
2. **Run Simulation**: Analyze earthquake response with advanced physics
3. **Get AI Recommendations**: Click one button for expert optimization advice
4. **Implement Changes**: Follow prioritized suggestions to improve safety

## Features

- Real-time earthquake simulation with multiple structural systems
- Material comparison (Concrete, Steel, Wood, Masonry)
- Base isolation modeling
- USGS real earthquake integration
- Damage assessment and life safety evaluation
- **NEW**: AI-powered optimization and cost analysis

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Backend**: Next.js API Routes, TypeScript
- **AI**: OpenAI GPT-4o API
- **Physics**: Nonlinear time-history analysis, Newmark-Beta integration

## Getting Started

```bash
# Install dependencies
cd frontend/quake-sim-ui
npm install

# Add your OpenAI API key (see QUICK_START.md)
# Edit .env.local with your key

# Run development server
npm run dev
```

Navigate to `http://localhost:3000`

## Project Structure

```
├── frontend/quake-sim-ui/
│   ├── app/
│   │   ├── api/
│   │   │   ├── optimize/         # AI optimization endpoint
│   │   │   ├── simulate/         # Physics simulation
│   │   │   └── usgs-events/      # Real earthquake data
│   │   ├── components/           # React components
│   │   └── pages/                # Application pages
│   └── .env.local                # Your API keys (DO NOT COMMIT)
├── data/                         # Seismic wave recordings
├── AI_OPTIMIZATION_README.md     # Complete AI feature docs
├── QUICK_START.md                # 2-minute setup guide
└── PARAMETER_GUIDE.md            # Physics and parameter explanations
```

## Documentation

- **[QUICK_START.md](QUICK_START.md)** - Get AI optimization running in 2 minutes
- **[AI_OPTIMIZATION_README.md](AI_OPTIMIZATION_README.md)** - Complete AI feature guide
- **[PARAMETER_GUIDE.md](PARAMETER_GUIDE.md)** - Physics explanations
- **[TESTING_GUIDE.md](TESTING_GUIDE.md)** - Test scenarios

## License

See [LICENSE](LICENSE) file for details.

---

**Built with ❤️ for safer buildings through AI and physics**