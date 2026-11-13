import '@rc-component/tour';

// rc-tour 将未声明的 restProps 透传给 rc-trigger，popupAlign 运行时可用但类型缺失。
// 零偏移 + 全轴 shift/adjust：窄屏平移钳制后卡片精确贴合视口边缘，不会残留偏移裁切。
declare module '@rc-component/tour' {
  interface TourProps {
    popupAlign?: {
      offset?: [number, number];
      overflow?: {
        adjustX?: boolean;
        adjustY?: boolean;
        shiftX?: boolean | number;
        shiftY?: boolean | number;
      };
    };
  }
}