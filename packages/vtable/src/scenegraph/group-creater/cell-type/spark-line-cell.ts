import type { ILine, ISymbol } from '@visactor/vrender';
import { createLine, createSymbol } from '@visactor/vrender';
import { PointScale, LinearScale } from '@visactor/vscale';
import { isValid } from '../../../tools/util';
import { Group } from '../../graphic/group';
import type { CellInfo, SparklineSpec } from '../../../ts-types';
import { getCellTheme } from './text-cell';
import type { BaseTableAPI } from '../../../ts-types/base-table';

const xScale: PointScale = new PointScale();
const yScale: LinearScale = new LinearScale();

export function createSparkLineCellGroup(
  cellGroup: Group | null,
  columnGroup: Group,
  xOrigin: number,
  yOrigin: number,
  col: number,
  row: number,
  width: number,
  height: number,
  padding: number[],
  table: BaseTableAPI
) {
  const cellTheme = getCellTheme(table, col, row);
  // cell
  if (!cellGroup) {
    cellGroup = new Group({
      x: xOrigin,
      y: yOrigin,
      width,
      height,

      // 背景相关，cell背景由cellGroup绘制
      fill: true,
      stroke: true,

      lineWidth: cellTheme?.group?.lineWidth ?? undefined,
      fillColor: cellTheme?.group?.fillColor ?? undefined,
      strokeColor: cellTheme?.group?.strokeColor ?? undefined,

      strokeArrayWidth: (cellTheme?.group as any)?.strokeArrayWidth ?? undefined,
      strokeArrayColor: (cellTheme?.group as any)?.strokeArrayColor ?? undefined,
      cursor: (cellTheme?.group as any)?.cursor ?? undefined,

      lineCap: 'square',

      clip: true
    } as any);
    cellGroup.role = 'cell';
    cellGroup.col = col;
    cellGroup.row = row;
    columnGroup.addChild(cellGroup);
  }

  // chart
  const chartGroup = createSparkLine(col, row, width, height, padding, table);
  if (chartGroup) {
    cellGroup.appendChild(chartGroup);
  }

  return cellGroup;
}

function createSparkLine(
  col: number,
  row: number,
  width: number,
  height: number,
  padding: number[],
  table: BaseTableAPI
): Group | undefined {
  //获取场景树对象，根据当前单元格位置更改其位置
  //待定 TODO group需要设置shape属性吗
  let sparklineSpec: SparklineSpec;
  let chartGroup: Group;
  const chartSpecRaw = table.internalProps.layoutMap.getBody(col, row).sparklineSpec;
  const dataValue = table.getCellValue(col, row) as unknown as any[];

  if (!Array.isArray(dataValue)) {
    return undefined;
  }

  const x = padding[3];
  const y = padding[0];
  width -= padding[1] + padding[3];
  height -= padding[0] + padding[2];
  const left = 0;
  // const top = y;
  // const right = x + width;
  const bottom = height;
  if (typeof chartSpecRaw === 'function') {
    // 动态组织spec
    const arg = {
      col,
      row,
      dataValue: table.getCellOriginValue(col, row) || '',
      value: table.getCellValue(col, row) || '',
      rect: table.getCellRangeRelativeRect(table.getCellRange(col, row)),
      table
    };
    sparklineSpec = chartSpecRaw(arg);
    chartGroup = createChartGroup(sparklineSpec, x, y, width, height);
  } else {
    sparklineSpec = chartSpecRaw;
    chartGroup = createChartGroup(chartSpecRaw, x, y, width, height);
  }

  // #region scale对x y轴映射
  const items: { x: number; y: number; defined?: boolean }[] = [];
  const dataItems: any[] = [];

  let xField;
  let yField;
  if (typeof sparklineSpec.xField === 'object') {
    xScale.domain(sparklineSpec.xField.domain);
    xField = sparklineSpec.xField.field;
  } else if (typeof sparklineSpec.xField === 'string') {
    const indexValues = dataValue.map((value: any) => value[sparklineSpec.xField as string]);
    xScale.domain(indexValues);
    xField = sparklineSpec.xField;
  }
  xScale.range([0, width]);

  if (typeof sparklineSpec.yField === 'object') {
    yScale.domain(sparklineSpec.yField.domain);
    yField = sparklineSpec.yField.field;
  } else if (typeof sparklineSpec.yField === 'string') {
    // string类型 自动计算出domain
    const values = dataValue.map((value: any) => value[sparklineSpec.yField as string]);
    yScale.domain([Math.min(...values), Math.max(...values)]);
    yField = sparklineSpec.yField;
  }
  yScale.range([0, height]);

  if (typeof sparklineSpec.xField === 'object' && Array.isArray(sparklineSpec.xField.domain)) {
    // 如果xField.domain合法，需要按需补充null值点
    const values = dataValue.map((value: any) => value[(sparklineSpec.xField as any).field]);
    const domain = sparklineSpec.xField.domain;
    for (let i = 0; i < domain.length; i++) {
      let valid = false;
      for (let j = 0; j < values.length; j++) {
        // eslint-disable-next-line eqeqeq
        if (domain[i] == values[j]) {
          const data: any = dataValue[j];
          // 无效数据不进行scale，避免null被解析为0
          if (!isValid(data[xField]) || !isValid(data[yField])) {
            break;
          }
          items.push({
            x: left + xScale.scale(data[xField]),
            y: bottom - yScale.scale(data[yField]),
            defined: isValid(data[yField])
          });
          dataItems.push(data); //收集原始数据
          valid = true;
          break;
        }
      }

      if (!valid) {
        // 该domain的index没有在数据中，补充无效点
        items.push({
          x: left + xScale.scale(domain[i]),
          y: 0,
          defined: false
        });
        dataItems.push({ [xField]: domain[i], [yField]: null });
      }
    }
  } else {
    for (let i = 0; i < dataValue.length; i++) {
      const data: any = dataValue[i];
      items.push({
        x: left + xScale.scale(data[xField]),
        y: bottom - yScale.scale(data[yField]),
        defined: isValid(data[yField]),
        rawData: data
      } as any);
      dataItems.push(data);
    }
  }
  // #endregion

  // 更新线节点属性
  const line = chartGroup.getChildByName('sparkline-line') as ILine;
  if (line) {
    line.setAttribute('points', items);
  }
  (line as any).bandwidth = xScale.step();
  (line as any).min = yScale.range()[0];
  (line as any).max = yScale.range()[1];

  // 更新symbol节点属性
  const symbolGroup = chartGroup.getChildByName('sparkline-symbol-group') as ILine;
  if (symbolGroup) {
    const isShowIsolatedPoint = sparklineSpec.symbol?.visible && sparklineSpec.pointShowRule === 'isolatedPoint';
    if (sparklineSpec.symbol?.visible && sparklineSpec.pointShowRule === 'all') {
      for (let i = 0; i < items.length; i++) {
        const { x, y, defined } = items[i];
        if (defined) {
          const symbol: ISymbol = createSymbol({ x, y });
          symbolGroup.appendChild(symbol);
        }
      }
    } else if (isShowIsolatedPoint) {
      // 处理孤立点显示
      for (let i = 0; i < items.length; i++) {
        const { x, y, defined } = items[i];
        if (defined && (!items[i - 1] || !items[i - 1].defined) && (!items[i + 1] || !items[i + 1].defined)) {
          // 规范孤立数据显示Symbol的spec api
          const symbol: ISymbol = createSymbol({ x, y });
          symbolGroup.appendChild(symbol);
        }
      }
    }
  }
  return chartGroup;
}

function createChartGroup(
  spec: SparklineSpec | ((arg: CellInfo) => SparklineSpec),
  x: number,
  y: number,
  width: number,
  height: number
): Group {
  let specObj: SparklineSpec;
  if (typeof spec === 'function') {
    // specObj = spec.apply(null, null);
    specObj = spec(null);
  } else {
    specObj = spec;
  }
  // 生成根节点
  const group = new Group({
    x,
    y,
    width,
    height
  });
  group.name = 'sparkline';

  if (specObj.type === 'line') {
    // 生成line
    const line = createLine({
      x: 0,
      y: 0,
      curveType: specObj.smooth ?? specObj.line?.style?.interpolate === 'monotone' ? 'monotoneX' : 'linear',
      strokeColor: specObj.line?.style?.stroke ?? 'blue',
      lineWidth: specObj.line?.style?.strokeWidth ?? 2
    });
    line.name = 'sparkline-line';
    group.addChild(line);
    if (specObj.crosshair) {
      (line as any).hover = specObj.crosshair?.style ?? {
        stroke: '#000',
        interpolate: 'linear'
      };
    }

    // 生成symbol
    const symbolGroup = new Group({
      x: 0,
      y: 0,
      width,
      height
    });
    symbolGroup.name = 'sparkline-symbol-group';
    symbolGroup.setTheme({
      symbol: {
        fill: true,
        stroke: true,
        strokeColor: specObj.symbol?.style?.stroke ?? '#000',
        lineWidth: specObj.symbol?.style?.strokeWidth ?? 1,
        fillColor: specObj.symbol?.style?.fill ?? '#000',
        size: (specObj.symbol?.style?.size ?? 3) * 2, // 之前配置的是圆半径
        symbolType: 'circle'
      }
    });
    group.addChild(symbolGroup);
    (symbolGroup as any).hover = specObj.symbol?.state?.hover ?? false;
  }
  return group;
}
