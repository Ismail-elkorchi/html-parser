# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#21

## Input
```html
<b><table><td></b><i></table>X
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
|       "X"

```

## Actual
```text
| <b>
|   <table>
|     <td>
| <i>
|   "X"
```
