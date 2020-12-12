import path from "path";
import ts, { factory } from "typescript";

function createPrintCallExpression(args: ts.Expression[]) {
	return factory.createCallExpression(factory.createIdentifier("print"), undefined, args);
}


function createDbgPrefix(node: ts.Node) {
	const sourceFile = node.getSourceFile();
	const linePos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
	const relativePath = path.relative(process.cwd(), node.getSourceFile().fileName).replace(/\\/g, "/");
	return factory.createStringLiteral(`[${relativePath}:${linePos.line}] ${node.getText()} =`, true);
}

export function transformToDebugPrint(node: ts.Expression): ts.Expression {
	return createPrintCallExpression([factory.createStringLiteral(node.getText()), node]);
}

export function isDebugMacro(node: ts.Expression): node is ts.CallExpression {
	return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "$dbg";
}

export function transformToIIFEDebugPrint(argument: ts.Expression): ts.Expression {
	const id = factory.createIdentifier("value");
	return factory.createCallExpression(
		factory.createParenthesizedExpression(
			factory.createArrowFunction(
				undefined,
				undefined,
				[factory.createParameterDeclaration(undefined, undefined, undefined, id)],
				undefined,
				undefined,
				factory.createBlock([
					factory.createExpressionStatement(createPrintCallExpression([createDbgPrefix(argument), id])),
					factory.createReturnStatement(id),
				]),
			),
		),
		undefined,
		[argument],
	);
}

export default function transformDbgExpression(node: ts.CallExpression): ts.ExpressionStatement | undefined {
	const { arguments: args } = node;
	if (args.length > 0) {
		const [expression] = args;
		if (ts.isCallExpression(expression)) {
			console.log("callExpression", expression.getText());
		}

		return factory.createExpressionStatement(transformToDebugPrint(expression));
	} else {
		console.log("invalid args");
		return;
	}
}