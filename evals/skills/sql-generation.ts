import { ConsoleLogger } from '@microsoft/teams.common';
import { SQLJudge } from '../judge/sql';
import * as fs from 'fs';
import * as path from 'path';
import { createDataAnalystPrompt } from '../../src/prompt';

interface EvalCase {
    task: string;
    user_query: string;
    sql_query: string; // The expert/ideal SQL query
}

interface EvalResult {
    task: string;
    user_query: string;
    expected_sql: string;
    actual_sql?: string;
    success: boolean;
    judge_result: {
        result: boolean;
        score: number;
        reasoning: string;
    };
    error?: string;
}

async function evaluateSqlGeneration() {
    const log = new ConsoleLogger('sql-generation-eval', { level: 'info' });

    // Load test cases
    const evalFilePath = path.join(__dirname, '..', 'sql-eval.jsonl');
    const evalContent = fs.readFileSync(evalFilePath, 'utf-8');
    const evalCases: EvalCase[] = JSON.parse(evalContent);

    // Check if run-one flag is passed
    const runOne = process.argv.includes('--run-one');
    const casesToRun = runOne ? evalCases.slice(1, 2) : evalCases;
    const results: EvalResult[] = [];

    // Run each test case
    for (const testCase of casesToRun) {
        log.info(`Evaluating: ${testCase.task}`);

        try {
            // Create a new prompt instance for this request
            const judge = SQLJudge();
            const dataAnalyst = createDataAnalystPrompt();

            // Use the new prompt agent to generate a response
            const userPrompt = `Here's the user query: ${testCase.user_query}. \nCan you simply generate the SQL query to answer the question? Please don't execute it. \nJust return the SQL query as text.`;
            const response = await dataAnalyst.prompt.send(userPrompt);

            // Get judgment from SQL judge
            const judgeResult = await judge.evaluate({
                input: testCase.user_query,
                ideal: testCase.sql_query,
                completion: typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
            });
            results.push({
                task: testCase.task,
                user_query: testCase.user_query,
                expected_sql: testCase.sql_query,
                actual_sql: typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
                success: judgeResult.result,
                judge_result: {
                    result: judgeResult.result,
                    score: judgeResult.score,
                    reasoning: judgeResult.reasoning,
                },
            });
        } catch (error) {
            console.log(`Error while evaluating: ${error}`);
            results.push({
                task: testCase.task,
                user_query: testCase.user_query,
                expected_sql: testCase.sql_query,
                success: false,
                judge_result: {
                    result: false,
                    score: 0,
                    reasoning: error instanceof Error ? error.message : 'Unknown error',
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
        output += `User Query: ${result.user_query}\n`;
        output += `Expected SQL: ${result.expected_sql}\n`;
        output += `Actual SQL: ${result.actual_sql || 'N/A'}\n`;
        output += `Judge Result: ${result.judge_result.result ? 'Correct' : 'Incorrect'} (Score: ${result.judge_result.score})\n`;
        if (result.judge_result.reasoning) {
            output += `Judge Reasoning: ${result.judge_result.reasoning}\n`;
        }

        if (!result.success && result.error) {
            output += `\nError: ${result.error}\n`;
        }

        output += '\n=== SQL Expert Evaluation Results ===\n\n';
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
    const logFilePath = path.join(logDir, `sql-eval-${timestamp}.log`);
    fs.writeFileSync(logFilePath, output);
    console.log(`\nResults have been written to: ${logFilePath}`);
}

// Run evaluation
evaluateSqlGeneration().catch(error => {
    console.error('Evaluation failed:', error);
    process.exit(1);
});
