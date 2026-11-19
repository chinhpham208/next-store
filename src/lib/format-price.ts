// Created once: constructing Intl.NumberFormat is expensive relative to format().
const VND_FORMATTER = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })

export const formatPrice = (vnd: number): string => VND_FORMATTER.format(vnd)
