import { ConsoleLogger } from '@microsoft/teams.common';
import { ACJudge } from '../judge/ac';
import * as fs from 'fs';
import * as path from 'path';
import { createDataAnalystPrompt } from '../../src/prompt';

interface EvalCase {
    task: string;
    input_data: Array<object>;
    visualization_type: string;
    expected_card: object;
}

interface EvalResult {
    task: string;
    input_data: string;
    visualization_type: string;
    expected_card: string;
    actual_card?: string;
    success: boolean;
    judge_result: {
        choice: 'Correct' | 'Incorrect';
        score: number;
        reason?: string;
    };
    error?: string;
}

async function evaluateACGeneration() {
    const log = new ConsoleLogger('ac-expert-eval', { level: 'debug' });

    // Load test cases
    const evalFilePath = path.join(__dirname, '..', 'ac-eval.jsonl');
    const evalContent = fs.readFileSync(evalFilePath, 'utf-8');
    const evalCases: EvalCase[] = JSON.parse(evalContent);

    // Check if run-one flag is passed
    const runOne = process.argv.includes('--run-one');
    const casesToRun = runOne ? evalCases.slice(1, 2) : evalCases;
    const results: EvalResult[] = [];

    // Run each test case
    for (const testCase of casesToRun) {
        const judge = ACJudge();

        log.info(`Evaluating: ${testCase.task}`);

        try {
            // Create a new prompt instance for this request
            const dataAnalyst = createDataAnalystPrompt();

            // Use the new prompt agent to generate a response
            const userPrompt = `Create an appropriate visualization for this data: ${JSON.stringify(testCase.input_data)}. Please return a single card.\nUse the following type of visualization: ${testCase.visualization_type}.`;
            await dataAnalyst.prompt.send(userPrompt);

            const generatedCard = dataAnalyst.attachments[0];

            // Get judgment from AC judge
            const judgeResult = await judge.evaluate({
                input: JSON.stringify(testCase.input_data),
                ideal: JSON.stringify(testCase.expected_card),
                completion: JSON.stringify(generatedCard),
            });

            results.push({
                task: testCase.task,
                input_data: JSON.stringify(testCase.input_data, null, 2),
                visualization_type: testCase.visualization_type,
                expected_card: JSON.stringify(testCase.expected_card, null, 2),
                actual_card: JSON.stringify(generatedCard),
                success: judgeResult.result,
                judge_result: {
                    choice: judgeResult.result ? 'Correct' : 'Incorrect',
                    score: judgeResult.score,
                    reason: judgeResult.reasoning,
                },
            });
        } catch (error) {
            results.push({
                task: testCase.task,
                input_data: JSON.stringify(testCase.input_data, null, 2),
                visualization_type: testCase.visualization_type,
                expected_card: JSON.stringify(testCase.expected_card, null, 2),
                success: false,
                judge_result: {
                    choice: 'Incorrect',
                    score: 0,
                    reason: error instanceof Error ? error.message : 'Unknown error',
                },
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    // Output results
    outputResults(results);
}

function outputResults(results: EvalResult[]) {
    const totalTests = results.length;
    const successfulTests = results.filter(r => r.success).length;
    const failedTests = totalTests - successfulTests;

    let output = '';

    // Output detailed results
    results.forEach((result, index) => {
        output += `\n--- Test Case ${index + 1}: ${result.task} ---\n`;
        output += `Success: ${result.success ? '\u2705' : '\u274c'}\n`;
        output += `Visualization Type: ${result.visualization_type}\n`;
        output += `Input Data: ${result.input_data}\n`;
        output += `\nActual Card Output:\n${result.actual_card}\n`;
        output += `Judge Result: ${result.judge_result.choice} (Score: ${result.judge_result.score})\n`;
        if (result.judge_result.reason) {
            output += `Judge Reasoning: ${result.judge_result.reason}\n`;
        }

        if (!result.success && result.error) {
            output += `\nError: ${result.error}\n`;
        }

        output += '\n=== Adaptive Card Expert Results Overview ===\n\n';
        output += `Total Tests: ${totalTests}\n`;
        output += `Successful: ${successfulTests}\n`;
        output += `Failed: ${failedTests}\n`;
        output += `Success Rate: ${((successfulTests / totalTests) * 100).toFixed(2)}%\n\n`;
    });

    // Write to console
    console.log(output);

    // Write to log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logFilePath = path.join(logDir, `ac-eval-${timestamp}.log`);
    fs.writeFileSync(logFilePath, output);
    console.log(`\nResults have been written to: ${logFilePath}`);
}

// Run evaluation
evaluateACGeneration().catch(error => {
    console.error('Evaluation failed:', error);
    process.exit(1);
});
