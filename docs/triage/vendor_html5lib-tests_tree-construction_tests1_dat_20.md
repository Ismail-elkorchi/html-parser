# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#20

## Input
```html
<b><table><td><i></table>
```

## Expected
```text
| <html>
|   <head>
|   <body>
|     <b>
|       <table>
|         <tbody>
|           <tr>
|             <td>
|               <i>

```

## Actual
```text
| <b>
|   <table>
|     <td>
|       <i>
```
