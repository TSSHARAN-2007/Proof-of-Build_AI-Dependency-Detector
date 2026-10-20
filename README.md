# Proof-of-Build_AI-Dependency-Detector
An interactive tool that analyzes a public GitHub repository and assesses how well you understand its code, with adaptive questions, optional LLM feedback, and personalized improvement tips

# AI Dependency Detector

**AI can write the code. Can you explain it?**

AI Dependency Detector is an interactive prototype that analyzes a public GitHub repository and helps developers reflect on how well they understand its structure and code. It maps selected project files, asks repository-grounded questions, and provides a report with feedback and suggested next steps.

## Features

- Analyze public GitHub repositories
- Explore a project map, detected technology stack, and repository signals
- Choose a 4-question written assessment or a 10-question multiple-choice deep dive
- Get questions based on the repository’s files and structure
- Use the microphone button to dictate written answers in supported browsers
- Review previous answers, explanations, and correct-answer guidance
- Get optional LLM question generation and answer verification
- View assessment scores, areas to improve, and actionable suggestions
- Use a responsive black-and-gold interface with click sound effects

## Try it locally

**Requirements:** Node.js 18 or newer.

1. Download or clone this repository.
2. On Windows, run `start-local.bat`. Alternatively, run:

   ```bash
   npm run dev
