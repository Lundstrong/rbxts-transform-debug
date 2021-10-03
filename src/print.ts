import ts, { factory } from "typescript";
import { DebugTransformConfiguration } from ".";
import { createDebugPrefixLiteral } from "./shared";

export function transformPrint(node: ts.CallExpression, config: DebugTransformConfiguration): ts.CallExpression {
	return factory.updateCallExpression(node, factory.createIdentifier("print"), undefined, [
		createDebugPrefixLiteral(node, config),
		...node.arguments,
	]);
}

export function transformWarning(node: ts.CallExpression, config: DebugTransformConfiguration): ts.CallExpression {
	return factory.updateCallExpression(node, factory.createIdentifier("warn"), undefined, [
		createDebugPrefixLiteral(node, config),
		...node.arguments,
	]);
}
